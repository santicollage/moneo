/**
 * Cabeceras de seguridad (RNF-SEG-08, `seguridad.md` §8). Una sola fuente para `next.config.ts`
 * (todas las respuestas que sirve Next) y para `manejar()` (las respuestas de la API, también
 * cuando se llaman como funciones en las pruebas, T-5).
 */

/** API: nada que pintar ni que cargar. */
export const CSP_API = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * Páginas: base mínima. `'unsafe-inline'` en scripts es lo que hoy necesita Next sin nonce;
 * endurecer con nonce se decide en F6-07 (Lighthouse y CSP de las pantallas reales).
 * En desarrollo, React necesita `'unsafe-eval'`.
 */
export function cspPaginas(desarrollo: boolean): string {
  const script = ["'self'", "'unsafe-inline'", ...(desarrollo ? ["'unsafe-eval'"] : [])];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Comunes a todo: HSTS de 2 años (≥ 1 año, RNF-SEG-08), sin sniffing, sin marcos. */
export const CABECERAS_COMUNES: ReadonlyArray<readonly [string, string]> = [
  ["Strict-Transport-Security", "max-age=63072000; includeSubDomains"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["X-Frame-Options", "DENY"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"],
];

/** Lo que `manejar()` pone en cada respuesta de `/api/v1`. */
export const CABECERAS_API: ReadonlyArray<readonly [string, string]> = [
  ...CABECERAS_COMUNES,
  ["Content-Security-Policy", CSP_API],
  // Ni el navegador ni el service worker guardan cifras (RNF-DIS-PWA-04, ADR-010).
  ["Cache-Control", "no-store"],
];
