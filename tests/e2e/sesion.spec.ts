/**
 * E2E-5 · Sesión (F4-05c; §8 de la estrategia de testing; UC-02, UC-02 A2; CT-03; EN-11; T-12).
 *
 * Contra la app (`pnpm dev` local o `pnpm start` en el CI) y el Supabase LOCAL con Mailpit.
 * Corre en serie: cada caso parte del estado que dejó el anterior (una sola cuenta de prueba).
 *
 *   1. Un correo fuera de la lista ve el mismo «Revisa tu correo», no recibe correo y no se crea.
 *   2. Registro → enlace del correo (apunta a la app) → «confirmado»; la URL ya no trae el fragmento.
 *   3. Entrar → /empezar muestra la identidad de E-10; la cookie es HttpOnly y SameSite=Lax.
 *   4. Token de acceso vencido (EN-11): el proxy lo refresca y la sesión sigue.
 *   5. Salir (E-06): la cookie guardada, ya vencida, no vuelve a entrar (CT-03).
 *   6. Salir de todos (E-07): la sesión de otro navegador, al vencer su acceso, queda fuera.
 *      Mientras su token de acceso no vence, sigue sirviendo: riesgo aceptado R57.
 *   7. T-12: con una sesión normal, E-09 sin un enlace de recuperación válido → 400.
 *   8. Recuperar por Mailpit → /restablecer → la vieja ya no entra y la nueva sí.
 *
 * Lo que no cubre: R48 (el enlace abierto en otro navegador o en el Android): se prueba a mano.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { dueno, permitir, quitarPermiso, usuariosConCorreo } from "../auth-local/_comun";
import {
  abrir,
  BASE,
  conAccesoVencido,
  correosPara,
  enlaceDelCorreo,
  entrar,
  escribirSesion,
  expDelAcceso,
  leerSesion,
  reiniciarContadorIp,
} from "./_ayudantes";

test.describe.configure({ mode: "serial" });

const correo = `e2e-${randomUUID()}@moneo.test`;
const ajeno = `e2e-ajeno-${randomUUID()}@moneo.test`;
// Frases de prueba de ≥ 15 caracteres, distintas en cada corrida. Nunca contraseñas reales.
const clave = `frase de prueba ${randomBytes(6).toString("hex")}`;
const claveNueva = `otra frase nueva ${randomBytes(6).toString("hex")}`;

const nuevoContexto = (browser: Browser) => browser.newContext({ baseURL: BASE });

test.beforeAll(async () => {
  await permitir(correo);
});

// El contador por IP se comparte entre corridas locales: ver `reiniciarContadorIp`.
test.beforeEach(async () => {
  await reiniciarContadorIp();
});

test.afterAll(async () => {
  await quitarPermiso(correo);
  await dueno.end();
});

test("1 · un correo fuera de la lista recibe la misma respuesta y no se registra", async ({
  page,
}) => {
  await abrir(page, "/registro");
  await page.getByLabel("Nombre").fill("Ajeno");
  await page.getByLabel("Correo").fill(ajeno);
  await page.getByLabel("Contraseña", { exact: true }).fill(clave);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();

  // Tiempo de sobra para que Mailpit lo hubiera recibido (el permitido llega en < 1 s).
  await page.waitForTimeout(3_000);
  expect(await correosPara(ajeno)).toBe(0);
  expect(await usuariosConCorreo(ajeno)).toBe(0);
});

test("2 · registro y confirmación con el enlace del correo", async ({ page }) => {
  await abrir(page, "/registro");
  await page.getByLabel("Nombre").fill("Ana E2E");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(clave);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();

  const enlace = await enlaceDelCorreo(correo, "Confirma tu correo", "/confirmar");
  expect(enlace.startsWith(`${BASE}/confirmar#token_hash=`)).toBe(true);

  await page.goto(enlace);
  await expect(page.getByText("Listo, tu correo quedó confirmado.")).toBeVisible();
  // S-6: el token no se queda en la barra ni en el historial.
  await expect(page).toHaveURL(`${BASE}/confirmar`);
});

test("3 · entrar muestra la identidad (E-10) y la cookie es HttpOnly", async ({ browser }) => {
  const a = await nuevoContexto(browser);
  const page = await a.newPage();
  await entrar(page, correo, clave);
  await expect(page.getByTestId("identidad")).toContainText("Ana E2E");

  const cookies = (await a.cookies(BASE)).filter((c) => c.name.startsWith("moneo-sesion"));
  expect(cookies.length).toBeGreaterThan(0);
  for (const c of cookies) {
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
  }
  await a.close();
});

test("4 · token de acceso vencido: el proxy refresca y la sesión sigue (EN-11)", async ({
  browser,
}) => {
  const a = await nuevoContexto(browser);
  const page = await a.newPage();
  await entrar(page, correo, clave);

  const sesion = await leerSesion(a);
  if (!sesion) throw new Error("Sin sesión tras entrar.");
  await escribirSesion(a, await conAccesoVencido(sesion));
  expect(await expDelAcceso(a)).toBeLessThan(Date.now() / 1000);

  await abrir(page, "/empezar");
  await expect(page.getByTestId("identidad")).toContainText(correo);
  expect(await expDelAcceso(a)).toBeGreaterThan(Date.now() / 1000);
  await a.close();
});

test("5 · salir (E-06): la cookie guardada no vuelve a entrar al vencer (CT-03)", async ({
  browser,
}) => {
  const a = await nuevoContexto(browser);
  const page = await a.newPage();
  await entrar(page, correo, clave);
  const guardada = await leerSesion(a);
  if (!guardada) throw new Error("Sin sesión tras entrar.");

  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/entrar`);
  expect(await leerSesion(a)).toBeNull();

  // Quien copió la cookie antes de salir: su refresco ya no vale y el acceso venció.
  await escribirSesion(a, await conAccesoVencido(guardada));
  await abrir(page, "/empezar");
  await expect(page).toHaveURL(`${BASE}/entrar`);
  await a.close();
});

test("6 · salir de todos (E-07): el otro navegador queda fuera al vencer su acceso", async ({
  browser,
}) => {
  const b = await nuevoContexto(browser);
  const c = await nuevoContexto(browser);
  const pb = await b.newPage();
  const pc = await c.newPage();
  await entrar(pb, correo, clave);
  await entrar(pc, correo, clave);

  await pb.getByRole("button", { name: "Salir de todos los dispositivos" }).click();
  await expect(pb).toHaveURL(`${BASE}/entrar`);

  // R57 (aceptado): hasta aquí, el token de acceso de C todavía serviría hasta su `exp`.
  const sesionC = await leerSesion(c);
  if (!sesionC) throw new Error("C no tiene sesión.");
  await escribirSesion(c, await conAccesoVencido(sesionC));
  await abrir(pc, "/empezar");
  await expect(pc).toHaveURL(`${BASE}/entrar`);
  await b.close();
  await c.close();
});

test("7 · T-12: una sesión normal no cambia la contraseña sin un enlace válido", async ({
  browser,
}) => {
  const a = await nuevoContexto(browser);
  const page = await a.newPage();
  await entrar(page, correo, clave);
  const r = await page.request.post(`${BASE}/api/v1/auth/reset-password`, {
    headers: { Origin: BASE },
    data: { tokenHash: "enlace-inventado-123", password: claveNueva },
  });
  expect(r.status()).toBe(400);
  expect(((await r.json()) as { code: string }).code).toBe("link_invalid");
  await a.close();
});

test("8 · recuperar por Mailpit y restablecer: la vieja no entra, la nueva sí", async ({
  browser,
}) => {
  const a = await nuevoContexto(browser);
  const page = await a.newPage();
  await abrir(page, "/recuperar");
  await page.getByLabel("Correo").fill(correo);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByText("te enviamos un enlace para elegir")).toBeVisible();

  const enlace = await enlaceDelCorreo(correo, "Restablece tu contraseña", "/restablecer");
  expect(enlace.startsWith(`${BASE}/restablecer#token_hash=`)).toBe(true);
  await page.goto(enlace);
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(`${BASE}/restablecer`);

  await page.getByLabel("Contraseña nueva").fill(claveNueva);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("Tu contraseña cambió.")).toBeVisible();
  await a.close();

  const d = await nuevoContexto(browser);
  const pd = await d.newPage();
  await abrir(pd, "/entrar");
  await pd.getByLabel("Correo").fill(correo);
  await pd.getByLabel("Contraseña", { exact: true }).fill(clave);
  await pd.getByRole("button", { name: "Entrar" }).click();
  await expect(pd.getByText("Correo o contraseña incorrectos.")).toBeVisible();

  await entrar(pd, correo, claveNueva);
  await d.close();
});
