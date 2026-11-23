/**
 * Sesión del actor (T-5, EN-11, F4-04b, F4-05a).
 *
 * Los Route Handlers NO leen cookies ni cabeceras de sesión por su cuenta: piden la sesión a un
 * `VerificadorSesion`. El de la app (F4-05a, `verificador-jwt.ts`) verifica el JWT de la cookie con
 * las claves públicas del proyecto (JWKS), sin instanciar el cliente de Auth ni refrescar: eso es
 * solo del `proxy.ts` (EN-11, G3-D1). En las pruebas se inyecta uno falso (`tests/autorizacion/falsos.ts`).
 *
 * Falla cerrado: sin cookie, con un token vencido, ajeno o mal formado → `null` (401). Sin
 * configuración válida, el servidor ni arranca (`instrumentation.ts`).
 */
import { verificadorDeConfig } from "./verificador-jwt";

/** Una entrada del claim `amr` del JWT de Supabase; `timestamp` en segundos Unix (EN-10). */
export type EntradaAmr = { readonly method: string; readonly timestamp: number };

export type Sesion = {
  /** `profile.id` = `auth.users.id` (M-2). */
  readonly profileId: string;
  readonly amr: readonly EntradaAmr[];
  /** Correo del claim `email`. Solo lo usa E-10 (`/me`); nunca va al log ni a Sentry (RNF-PRI-01). */
  readonly correo: string;
};

/** `null` = sin sesión válida. Lanzar solo ante un fallo de infraestructura (da 500, no 401). */
export type VerificadorSesion = (peticion: Request) => Promise<Sesion | null>;

let activo: VerificadorSesion | undefined;

/** Solo para las pruebas de integración (y para volver al de la app con `undefined`). */
export function fijarVerificador(verificador: VerificadorSesion | undefined): void {
  activo = verificador;
}

/** El verificador en uso: el inyectado, o el real (JWKS del proyecto) creado una vez por proceso. */
export function verificadorActivo(): VerificadorSesion {
  activo ??= verificadorDeConfig();
  return activo;
}
