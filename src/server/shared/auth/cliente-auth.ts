/**
 * El ÚNICO lugar donde se crean clientes de Supabase (ARQ-11, D-06, EN-11, F4-05a).
 *
 * - `clienteConCookies`: para el proxy (refresco) y, desde F4-05b, login y confirmación. La sesión
 *   vive en la cookie `moneo-sesion` (`HttpOnly`, `SameSite=Lax`, `Secure` con https), solo con los
 *   tokens (`encode: "tokens-only"`). Las cookies que escribe se entregan a `escribir`: quien llama
 *   decide dónde ponerlas (petición y respuesta en el proxy; respuesta en un Route Handler).
 * - `clienteSinSesion`: llamadas que no guardan sesión (cerrar sesión con el token del usuario).
 *
 * Solo con la clave PÚBLICA. La clave secreta de Supabase no existe en la app (S-7 por hook,
 * F4-05-D1). Ninguno de los dos se usa para leer tablas: los datos van por Prisma (D-06).
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";
import { opcionesCookie, type CookieLeida } from "./cookie-sesion";

export type CookieEscrita = { name: string; value: string; options: CookieOptions };

export type FuenteCookies = {
  leer: () => readonly CookieLeida[];
  /** Recibe las cookies a escribir y las cabeceras que la librería pide (`Cache-Control`…). */
  escribir: (cookies: CookieEscrita[], cabeceras: Record<string, string>) => void;
};

export type ConfigAuth = { url: string; clavePublica: string; cookiesSeguras: boolean };

export function configAuth(): ConfigAuth {
  const c = config();
  return {
    url: c.supabase.url,
    clavePublica: c.supabase.clavePublica,
    cookiesSeguras: c.cookiesSeguras,
  };
}

/**
 * `fetch` que se corta cuando vence `senal`, y que después falla al instante. auth-js reintenta un
 * refresco fallido con espera creciente hasta ≈ 30 s: sin esto el proxy se colgaría ese tiempo en
 * cada petición mientras Supabase no responde (F4-05a).
 */
export function conSenal(base: typeof fetch, senal: AbortSignal): typeof fetch {
  return (entrada, init) => {
    if (senal.aborted) return Promise.reject(senal.reason);
    const propias = init?.signal ? [init.signal, senal] : [senal];
    return base(entrada, { ...init, signal: AbortSignal.any(propias) });
  };
}

export function clienteConCookies(
  fuente: FuenteCookies,
  c: ConfigAuth = configAuth(),
  fetchPropio?: typeof fetch,
): SupabaseClient {
  return createServerClient(c.url, c.clavePublica, {
    cookieOptions: opcionesCookie(c.cookiesSeguras),
    cookies: {
      encode: "tokens-only",
      getAll: () => fuente.leer().map(({ name, value }) => ({ name, value })),
      setAll: (cookies, cabeceras) => fuente.escribir(cookies, cabeceras),
    },
    ...(fetchPropio ? { global: { fetch: fetchPropio } } : {}),
  });
}

export function clienteSinSesion(
  c: ConfigAuth = configAuth(),
  fetchPropio?: typeof fetch,
): SupabaseClient {
  return createClient(c.url, c.clavePublica, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(fetchPropio ? { global: { fetch: fetchPropio } } : {}),
  });
}
