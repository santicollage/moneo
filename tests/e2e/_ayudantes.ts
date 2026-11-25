/**
 * F4-05c · Ayudantes de E2E-5 (Playwright contra la app y el Supabase LOCAL).
 *
 * - La lista permitida y el conteo de usuarios se leen como dueño (`tests/auth-local/_comun.ts`).
 * - Los enlaces se toman del HTML del correo en Mailpit, tal cual: la prueba navega al `href`
 *   que recibiría la persona (comprueba que `site_url` y la plantilla apuntan a la app).
 * - `vencerAcceso` firma un token de acceso VENCIDO con la clave local (`supabase/signing_keys.json`)
 *   y las mismas claims del real: el proxy debe refrescarlo (o cerrar la sesión si el refresco ya
 *   no vale). Así se prueba el vencimiento sin esperar la hora de `jwt_expiry`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { decodeJwt, importJWK, SignJWT, type JWK } from "jose";
import { dueno, MAILPIT } from "../auth-local/_comun";

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const NOMBRE = "moneo-sesion";
const PREFIJO = "base64-";

/**
 * Pone en cero SOLO el contador por IP (DN-2) de la base LOCAL. En local todas las peticiones llegan
 * sin cabecera de IP y comparten un solo contador (20 por 15 min): varias corridas seguidas de E2E-5
 * lo agotarían. El contador de la CUENTA no se toca a propósito: E2E-5 entra 8 veces con una misma
 * cuenta y solo pasa si un login correcto borra los fallos (F4-05c, RNF-SEG-02).
 */
export async function reiniciarContadorIp(): Promise<void> {
  await dueno.query(`DELETE FROM rate_limit_counter WHERE scope = 'login:ip'`);
}

/** Abre una ruta y espera a que la página hidrate (antes, un clic no llega a React). */
export async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
  await page.waitForLoadState("networkidle");
}

export async function entrar(page: Page, correo: string, clave: string): Promise<void> {
  await abrir(page, "/entrar");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(clave);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(`${BASE}/empezar`);
  await expect(page.getByTestId("identidad")).toContainText(correo);
}

type Resumen = { ID: string; Subject: string };

/** Cuántos correos tiene Mailpit para `correo` (cualquier asunto). */
export async function correosPara(correo: string): Promise<number> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  if (!r.ok) throw new Error(`Mailpit respondió ${r.status}`);
  const { messages } = (await r.json()) as { messages: Resumen[] };
  return messages.length;
}

/** Espera el correo con `asunto` para `correo` y devuelve el `href` del enlace a `ruta`. */
export async function enlaceDelCorreo(
  correo: string,
  asunto: string,
  ruta: "/confirmar" | "/restablecer",
  plazoMs = 20_000,
): Promise<string> {
  const fin = Date.now() + plazoMs;
  while (Date.now() < fin) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
    if (r.ok) {
      const { messages } = (await r.json()) as { messages: Resumen[] };
      const m = messages.find((x) => x.Subject.includes(asunto));
      if (m) {
        const det = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
          HTML: string;
        };
        const hrefs = [...det.HTML.matchAll(/href="([^"]+)"/g)].map((x) =>
          (x[1] ?? "").replaceAll("&amp;", "&"),
        );
        const href = hrefs.find((h) => h.includes(`${ruta}#token_hash=`));
        if (!href) throw new Error(`El correo «${asunto}» no trae un enlace a ${ruta}.`);
        return href;
      }
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`No llegó a Mailpit el correo «${asunto}».`);
}

type SesionCookie = { access_token: string; refresh_token?: string; [k: string]: unknown };

/** Lee la cookie de sesión (entera o en trozos `.0`, `.1`…) tal como la escribió `@supabase/ssr`. */
export async function leerSesion(contexto: BrowserContext): Promise<SesionCookie | null> {
  const cookies = (await contexto.cookies(BASE)).filter(
    (c) => c.name === NOMBRE || /^moneo-sesion\.\d+$/.test(c.name),
  );
  if (cookies.length === 0) return null;
  const entera = cookies.find((c) => c.name === NOMBRE);
  const crudo =
    entera?.value ??
    cookies
      .sort((a, b) => Number(a.name.split(".")[1]) - Number(b.name.split(".")[1]))
      .map((c) => c.value)
      .join("");
  const json = crudo.startsWith(PREFIJO)
    ? Buffer.from(crudo.slice(PREFIJO.length), "base64url").toString("utf8")
    : crudo;
  return JSON.parse(json) as SesionCookie;
}

/** Reemplaza la sesión del contexto por `sesion` (una sola cookie, con las opciones de la app). */
export async function escribirSesion(
  contexto: BrowserContext,
  sesion: SesionCookie,
): Promise<void> {
  await contexto.clearCookies({ name: new RegExp(`^${NOMBRE}(\\.\\d+)?$`) });
  const valor = PREFIJO + Buffer.from(JSON.stringify(sesion), "utf8").toString("base64url");
  await contexto.addCookies([
    { name: NOMBRE, value: valor, url: BASE, httpOnly: true, sameSite: "Lax", secure: false },
  ]);
}

function clavePrivada(): JWK {
  const ruta = process.env.E2E_SIGNING_KEYS ?? join(process.cwd(), "supabase", "signing_keys.json");
  const claves = JSON.parse(readFileSync(ruta, "utf8")) as JWK[];
  const es256 = claves.find((k) => k.alg === "ES256");
  if (!es256) throw new Error("supabase/signing_keys.json no trae una clave ES256.");
  return es256;
}

/** Cambia el token de acceso de `sesion` por uno con las mismas claims, firmado y ya vencido. */
export async function conAccesoVencido(sesion: SesionCookie): Promise<SesionCookie> {
  const { kty, crv, x, y, d, kid } = clavePrivada();
  // Solo los campos de la clave: `key_ops` trae «verify» y jose no importa una privada con ese uso.
  const jwk: JWK = { kty, crv, x, y, d, kid };
  const ahora = Math.floor(Date.now() / 1000);
  const claims = decodeJwt(sesion.access_token);
  const token = await new SignJWT({ ...claims, iat: ahora - 3_720, exp: ahora - 120 })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .sign(await importJWK(jwk, "ES256"));
  return { ...sesion, access_token: token, expires_at: ahora - 120 };
}

/** El `exp` del token de acceso que tiene hoy el contexto. */
export async function expDelAcceso(contexto: BrowserContext): Promise<number> {
  const s = await leerSesion(contexto);
  if (!s) throw new Error("El contexto no tiene cookie de sesión.");
  const exp = decodeJwt(s.access_token).exp;
  if (typeof exp !== "number") throw new Error("El token de acceso no trae exp.");
  return exp;
}
