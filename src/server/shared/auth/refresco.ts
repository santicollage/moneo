/**
 * Refresco de la sesión: SOLO lo usa `src/proxy.ts` (EN-11, G3-D1, R54, F4-05a).
 *
 * Regla: se refresca cuando al token de acceso le quedan ≤ 60 s (o ya venció) y hay token de
 * refresco. Si le queda más, no se llama a Supabase: el proxy no agrega latencia ni red al 99 %
 * de las peticiones. No consulta la base de datos ni autoriza.
 *
 * El refresco lo hace `@supabase/ssr` (`getSession()` refresca si a la sesión le quedan < 90 s,
 * `EXPIRY_MARGIN_MS` de auth-js 2.119.2). Como solo se llama con ≤ 60 s, siempre refresca una vez;
 * la prueba `refresco.test.ts` lo fija para que una actualización de la librería no lo cambie en
 * silencio.
 *
 * Tope de 3 s (`PLAZO_REFRESCO_MS`): si Supabase no responde, se aborta la llamada y la petición
 * sigue con la cookie que traía. Si Supabase SÍ alcanzó a rotar el token pero la respuesta no llegó,
 * el navegador conserva el token viejo: Supabase lo acepta dentro de su intervalo de reúso; después
 * revoca la sesión (residuo de R54, igual que con cualquier corte de red).
 *
 * Si Supabase rechaza el token de refresco y el de acceso aún no venció, la librería conserva la
 * sesión (sirve hasta su `exp`); si ya venció, la borra (`cerrada`).
 *
 * Dos peticiones casi simultáneas pueden refrescar con el mismo token: Supabase lo tolera dentro
 * de su intervalo de reúso (10 s por defecto) y responde con la misma sesión nueva. Fuera de esa
 * ventana revocaría la sesión (R54): por eso nadie más refresca.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import {
  clienteConCookies,
  configAuth,
  conSenal,
  type CookieEscrita,
  type FuenteCookies,
} from "./cliente-auth";
import { leerTokens, type CookieLeida } from "./cookie-sesion";

export const MARGEN_REFRESCO_S = 60;
/** Tope del refresco dentro del proxy. Pasado, la petición sigue con la cookie que traía. */
export const PLAZO_REFRESCO_MS = 3_000;

/** ¿Hay que refrescar? Sin verificar la firma: decidir refrescar no autoriza nada. */
export function debeRefrescar(tokenAcceso: string, ahoraS: number): boolean {
  let exp: unknown;
  try {
    exp = decodeJwt(tokenAcceso).exp;
  } catch {
    return false;
  }
  return typeof exp === "number" && exp - ahoraS <= MARGEN_REFRESCO_S;
}

export type ResultadoRefresco =
  | { estado: "no_aplica" }
  /** Tokens nuevos (`refrescada`) o sesión borrada porque Supabase rechazó el refresco (`cerrada`). */
  | {
      estado: "refrescada" | "cerrada";
      cookies: CookieEscrita[];
      cabeceras: Record<string, string>;
    }
  /** Falló sin cambiar nada (red, Supabase caído): la petición sigue con la cookie que traía. */
  | { estado: "fallo"; errorCode: string };

export type DependenciasRefresco = {
  ahoraS: () => number;
  /** `senal` se aborta al vencer el plazo: el cliente debe usar un `fetch` que la respete. */
  crearCliente: (fuente: FuenteCookies, senal: AbortSignal) => SupabaseClient;
  plazoMs: number;
};

const porDefecto: DependenciasRefresco = {
  ahoraS: () => Math.floor(Date.now() / 1000),
  crearCliente: (fuente, senal) => clienteConCookies(fuente, configAuth(), conSenal(fetch, senal)),
  plazoMs: PLAZO_REFRESCO_MS,
};

const NOMBRE_ERROR = /^[A-Za-z0-9_]{1,40}$/;

export async function refrescarSiHaceFalta(
  cookies: readonly CookieLeida[],
  deps: Partial<DependenciasRefresco> = {},
): Promise<ResultadoRefresco> {
  const d = { ...porDefecto, ...deps };
  const tokens = await leerTokens(cookies);
  if (!tokens?.tokenRefresco || !debeRefrescar(tokens.tokenAcceso, d.ahoraS())) {
    return { estado: "no_aplica" };
  }

  const escritas: CookieEscrita[] = [];
  let cabeceras: Record<string, string> = {};
  let cerrado = false;
  const corte = new AbortController();
  const cliente = d.crearCliente(
    {
      leer: () => cookies,
      escribir: (lista, cab) => {
        if (cerrado) return; // llegó tarde: la respuesta ya salió sin estas cookies
        escritas.push(...lista);
        cabeceras = { ...cabeceras, ...cab };
      },
    },
    corte.signal,
  );

  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<"plazo">((resolver) => {
    temporizador = setTimeout(() => resolver("plazo"), d.plazoMs);
  });
  const resultado = await Promise.race([cliente.auth.getSession(), plazo]);
  clearTimeout(temporizador);
  if (resultado === "plazo") {
    cerrado = true;
    corte.abort(new Error("plazo de refresco vencido"));
    return { estado: "fallo", errorCode: "refresh_timeout" };
  }
  cerrado = true;
  const { error } = resultado;
  if (escritas.length === 0) {
    const nombre = error?.name;
    return {
      estado: "fallo",
      errorCode:
        typeof nombre === "string" && NOMBRE_ERROR.test(nombre) ? nombre : "refresh_failed",
    };
  }
  const quedaSesion = escritas.some((c) => c.value !== "" && c.options.maxAge !== 0);
  return { estado: quedaSesion ? "refrescada" : "cerrada", cookies: escritas, cabeceras };
}
