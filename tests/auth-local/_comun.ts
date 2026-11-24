/**
 * F4-05b · Ayudantes de las pruebas contra Supabase LOCAL (`pnpm test:auth-local`).
 *
 * - La lista permitida se carga como dueño (`TEST_OWNER_DATABASE_URL`), igual que en el runbook:
 *   con el hook S-7 activo, un `signUp` con un correo fuera de la lista falla.
 * - Los correos de confirmación y recuperación se leen de Mailpit (`[local_smtp]`, puerto 54324).
 */
import pg from "pg";

const URL_DUENO = process.env.TEST_OWNER_DATABASE_URL;
export const MAILPIT = (process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:54324").replace(
  /\/$/,
  "",
);

if (!URL_DUENO)
  throw new Error("Falta TEST_OWNER_DATABASE_URL (la prueba carga la lista permitida).");
if (!["127.0.0.1", "localhost"].includes(new URL(URL_DUENO).hostname)) {
  throw new Error("Estas pruebas solo corren contra Supabase local.");
}

export const dueno = new pg.Pool({ connectionString: URL_DUENO, max: 2 });

export async function permitir(correo: string): Promise<void> {
  await dueno.query(
    `INSERT INTO signup_gate.allowed_email (email) VALUES ($1) ON CONFLICT DO NOTHING`,
    [correo],
  );
}

export async function quitarPermiso(correo: string): Promise<void> {
  await dueno.query(`DELETE FROM signup_gate.allowed_email WHERE email = $1`, [correo]);
}

export async function usuariosConCorreo(correo: string): Promise<number> {
  const r = await dueno.query<{ n: string }>(
    `SELECT count(*) AS n FROM auth.users WHERE email = $1`,
    [correo],
  );
  return Number(r.rows[0]?.n);
}

export type Enlace = { tokenHash: string; type: "email" | "recovery" };

type Resumen = { ID: string; Subject: string; To: { Address: string }[] };

/**
 * Espera el correo más reciente para `correo` cuyo asunto contiene `asunto` y que no esté en
 * `vistos`, y devuelve el `token_hash` y el `type` del fragmento del enlace (`/confirmar#…` o
 * `/restablecer#…`).
 */
export async function esperarEnlace(
  correo: string,
  asunto: string,
  vistos: Set<string> = new Set(),
  plazoMs = 15_000,
): Promise<Enlace> {
  const fin = Date.now() + plazoMs;
  while (Date.now() < fin) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
    if (r.ok) {
      const { messages } = (await r.json()) as { messages: Resumen[] };
      const m = messages.find((x) => x.Subject.includes(asunto) && !vistos.has(x.ID));
      if (m) {
        vistos.add(m.ID);
        const det = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
          HTML: string;
        };
        const html = det.HTML.replaceAll("&amp;", "&");
        const f =
          /\/(?:confirmar|restablecer)#token_hash=([A-Za-z0-9_-]+)&type=(email|recovery)/.exec(
            html,
          );
        if (!f) throw new Error("El correo no trae el enlace con token_hash en el fragmento.");
        return { tokenHash: f[1]!, type: f[2] as Enlace["type"] };
      }
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(
    `No llegó a Mailpit el correo «${asunto}» (¿enable_confirmations = true y la plantilla?).`,
  );
}

/** `Set-Cookie` de una respuesta → cabecera `Cookie` (sin las que se borran). */
export function cookieDe(r: Response): string {
  return r.headers
    .getSetCookie()
    .filter((c) => !/Max-Age=0/i.test(c))
    .map((c) => c.split(";")[0]!)
    .join("; ");
}
