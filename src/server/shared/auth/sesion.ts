/**
 * Sesión del actor (T-5, EN-11, F4-04b).
 *
 * Los Route Handlers NO leen cookies ni cabeceras de sesión por su cuenta: piden la sesión a un
 * `VerificadorSesion`. En producción lo implementa F4-05 (JWT contra el JWKS del proyecto, sin
 * instanciar el cliente de Auth ni refrescar: eso es del `proxy.ts`, EN-11). En integración se usa
 * uno falso (`tests/autorizacion/falsos.ts`).
 *
 * Mientras F4-05 no exista, el verificador por defecto es `verificadorNoConfigurado`: devuelve
 * `null` y toda ruta que exige sesión responde 401. Falla cerrado, nunca abierto.
 */

/** Una entrada del claim `amr` del JWT de Supabase; `timestamp` en segundos Unix (EN-10). */
export type EntradaAmr = { readonly method: string; readonly timestamp: number };

export type Sesion = {
  /** `profile.id` = `auth.users.id` (M-2). */
  readonly profileId: string;
  readonly amr: readonly EntradaAmr[];
};

/** `null` = sin sesión válida. Lanzar solo ante un fallo de infraestructura (da 500, no 401). */
export type VerificadorSesion = (peticion: Request) => Promise<Sesion | null>;

export const verificadorNoConfigurado: VerificadorSesion = () => Promise.resolve(null);

let activo: VerificadorSesion = verificadorNoConfigurado;

/** Punto de enlace de F4-05 (y de las pruebas de integración). No lo llames desde un servicio. */
export function fijarVerificador(verificador: VerificadorSesion): void {
  activo = verificador;
}

export function verificadorActivo(): VerificadorSesion {
  return activo;
}
