/**
 * Verificador real de la sesión (EN-11, S-8, R49, F4-05a).
 *
 * Lee el token de acceso de la cookie `moneo-sesion` y lo verifica con `jose` contra las claves
 * PÚBLICAS del proyecto (JWKS en `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`):
 *   - firma con una clave del JWKS y algoritmo asimétrico (ES256 o RS256). Un token HS256 (secreto
 *     compartido heredado) o `none` se rechaza: el proyecto debe firmar con claves asimétricas.
 *   - `iss` = `<SUPABASE_URL>/auth/v1`, `aud` = `authenticated`, `role` = `authenticated`, no anónimo.
 *   - `exp`, `iat`, `sub` (UUID), `session_id` y `email` presentes; sin tolerancia de reloj.
 * Nunca instancia el cliente de Auth de Supabase ni refresca (eso es del proxy, G3-D1).
 *
 * Errores: token malo de cualquier forma → `null` (401). JWKS que no responde o no es válido →
 * se lanza (500 y Sentry): un fallo de infraestructura no puede parecer «no autenticado».
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { config } from "../config";
import { leerTokens, parseCookieHeader } from "./cookie-sesion";
import type { EntradaAmr, Sesion, VerificadorSesion } from "./sesion";

export const ALGORITMOS = ["ES256", "RS256"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OpcionesVerificador = {
  /** `iss` esperado. */
  emisor: string;
  /** Claves públicas (remotas en la app; locales en las pruebas). */
  claves: JWTVerifyGetKey;
  /** Reloj inyectable para las pruebas. */
  ahora?: () => Date;
};

function leerAmr(valor: unknown): EntradaAmr[] {
  if (!Array.isArray(valor)) return [];
  const salida: EntradaAmr[] = [];
  for (const e of valor as unknown[]) {
    if (typeof e !== "object" || e === null) continue;
    const { method, timestamp } = e as { method?: unknown; timestamp?: unknown };
    if (typeof method === "string" && typeof timestamp === "number" && Number.isFinite(timestamp)) {
      salida.push({ method, timestamp });
    }
  }
  return salida;
}

/** ¿El error es de la infraestructura (JWKS caído o inválido) y no del token? */
function esFalloDeInfraestructura(err: unknown): boolean {
  if (err instanceof errors.JWKSTimeout || err instanceof errors.JWKSInvalid) return true;
  return !(err instanceof errors.JOSEError);
}

/** Verifica un token de acceso. Pura salvo la obtención de claves. */
export async function verificarToken(
  token: string,
  o: OpcionesVerificador,
): Promise<Sesion | null> {
  let carga: JWTPayload;
  try {
    ({ payload: carga } = await jwtVerify(token, o.claves, {
      issuer: o.emisor,
      audience: "authenticated",
      algorithms: [...ALGORITMOS],
      requiredClaims: ["exp", "iat", "sub", "session_id", "email"],
      ...(o.ahora ? { currentDate: o.ahora() } : {}),
    }));
  } catch (err) {
    if (esFalloDeInfraestructura(err)) throw err;
    return null;
  }
  if (carga.role !== "authenticated" || carga.is_anonymous === true) return null;
  if (typeof carga.sub !== "string" || !UUID.test(carga.sub)) return null;
  if (typeof carga.email !== "string" || carga.email.length === 0) return null;
  return { profileId: carga.sub.toLowerCase(), amr: leerAmr(carga.amr), correo: carga.email };
}

/**
 * Verificador de peticiones. `opciones` se resuelve solo si hay cookie: una petición sin sesión
 * responde `null` sin tocar la configuración ni la red.
 */
export function crearVerificadorJwt(opciones: () => OpcionesVerificador): VerificadorSesion {
  return async (peticion) => {
    const tokens = await leerTokens(parseCookieHeader(peticion.headers.get("cookie") ?? ""));
    if (!tokens) return null;
    return verificarToken(tokens.tokenAcceso, opciones());
  };
}

/**
 * El de la app. `createRemoteJWKSet` guarda las claves en memoria y vuelve a pedirlas cuando
 * llega un `kid` desconocido (rotación), con una espera mínima entre pedidos.
 */
export function verificadorDeConfig(): VerificadorSesion {
  let opciones: OpcionesVerificador | undefined;
  return crearVerificadorJwt(() => {
    if (!opciones) {
      const { supabase } = config();
      opciones = {
        emisor: supabase.emisor,
        claves: createRemoteJWKSet(new URL(supabase.jwks), {
          timeoutDuration: 3_000,
          cooldownDuration: 30_000,
          cacheMaxAge: 10 * 60_000,
        }),
      };
    }
    return opciones;
  });
}
