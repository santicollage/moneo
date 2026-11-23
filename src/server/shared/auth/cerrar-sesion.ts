/**
 * E-06 y E-07: cerrar sesión (UC-02, EN-9, F4-05a).
 *
 * - E-06 cierra SOLO esta sesión (`scope: "local"`); E-07 cierra TODAS (`scope: "global"`).
 * - Se llama a `POST /auth/v1/logout?scope=…` con el token de acceso del usuario (supabase-js lo
 *   expone como `auth.admin.signOut(jwt, scope)`, pero NO usa la clave secreta: autentica el JWT).
 *   Así no se carga la sesión en un cliente con cookies, que podría refrescarla (EN-11: solo el
 *   proxy refresca).
 * - Después se borran la cookie y todos sus trozos con las mismas opciones con que se escribieron.
 * - Tras E-07 un token de acceso ya emitido sigue válido hasta su `exp` (≈ 1 h): riesgo aceptado R57.
 *
 * Errores de Supabase:
 *   - E-06: si Supabase ya no reconoce la sesión (401, 403, 404), se borra la cookie igual: el
 *     objetivo (salir de este navegador) se cumple.
 *   - E-07: cualquier error se propaga (500). Si se respondiera 204 sin haber cerrado las otras
 *     sesiones, la persona creería que un teléfono perdido ya no entra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { clienteSinSesion } from "./cliente-auth";
import { cookiesParaBorrar, leerTokens, parseCookieHeader } from "./cookie-sesion";
import { config } from "../config";

export type Alcance = "local" | "global";

const YA_CERRADA = new Set([401, 403, 404]);

/** auth-js a veces devuelve el error y a veces lo lanza (`AuthSessionMissingError` ante `session_not_found`). */
function sesionYaCerrada(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, status } = err as { name?: unknown; status?: unknown };
  return (
    name === "AuthSessionMissingError" || (typeof status === "number" && YA_CERRADA.has(status))
  );
}

export async function cerrarSesion(
  tokenAcceso: string,
  alcance: Alcance,
  cliente: SupabaseClient = clienteSinSesion(),
): Promise<void> {
  let error: unknown;
  try {
    ({ error } = await cliente.auth.admin.signOut(tokenAcceso, alcance));
  } catch (err) {
    error = err;
  }
  if (!error) return;
  if (alcance === "local" && sesionYaCerrada(error)) return;
  throw error;
}

export type DependenciasCierre = {
  cliente: () => SupabaseClient;
  cookiesSeguras: () => boolean;
};

const porDefecto: DependenciasCierre = {
  cliente: () => clienteSinSesion(),
  cookiesSeguras: () => config().cookiesSeguras,
};

/** Cierra la sesión de la petición y responde 204 con las cookies borradas. */
export async function cerrarSesionDePeticion(
  peticion: Request,
  alcance: Alcance,
  deps: Partial<DependenciasCierre> = {},
): Promise<Response> {
  const d = { ...porDefecto, ...deps };
  const cookies = parseCookieHeader(peticion.headers.get("cookie") ?? "");
  const tokens = await leerTokens(cookies);
  // `withPolicy` ya exigió una sesión válida; sin tokens solo queda limpiar.
  if (tokens) await cerrarSesion(tokens.tokenAcceso, alcance, d.cliente());
  const headers = new Headers();
  for (const c of cookiesParaBorrar(cookies, d.cookiesSeguras())) headers.append("Set-Cookie", c);
  return new Response(null, { status: 204, headers });
}
