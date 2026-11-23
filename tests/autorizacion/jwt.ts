// Ayudantes de F4-05a: claves de firma locales y JWT con la forma de los de Supabase Auth.
// Nada de red: el JWKS es local (`createLocalJWKSet`). Los valores se generan al correr: nada que
// parezca una credencial queda escrito en el repositorio (gitleaks, regla de F4-04c).
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";
import { NOMBRE_COOKIE } from "../../src/server/shared/auth/cookie-sesion";

export const EMISOR = "http://127.0.0.1:54321/auth/v1";
export const PERFIL = "0f8fad5b-d9cb-469f-a165-70867728950e";
export const SESION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

export type Llaves = {
  privada: CryptoKey;
  jwk: JWK;
  jwks: ReturnType<typeof createLocalJWKSet>;
};

export async function llaves(alg: "ES256" | "RS256" = "ES256", kid = "k1"): Promise<Llaves> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg, use: "sig" };
  return { privada: privateKey, jwk, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

/** Claims de un token de Supabase Auth para un usuario con correo y contraseña. */
export function claims(ahoraS: number, extra: JWTPayload = {}): JWTPayload {
  return {
    iss: EMISOR,
    sub: PERFIL,
    aud: "authenticated",
    role: "authenticated",
    email: "ana@moneo.test",
    session_id: SESION_ID,
    is_anonymous: false,
    aal: "aal1",
    amr: [{ method: "password", timestamp: ahoraS - 10 }],
    iat: ahoraS - 10,
    exp: ahoraS + 3600,
    ...extra,
  };
}

export async function firmar(
  privada: CryptoKey | Uint8Array,
  carga: JWTPayload,
  cabecera: { alg: string; kid?: string } = { alg: "ES256", kid: "k1" },
): Promise<string> {
  return new SignJWT(carga).setProtectedHeader({ typ: "JWT", ...cabecera }).sign(privada);
}

/** Cookie(s) de sesión tal como las escribe `@supabase/ssr` (`base64-` + base64url, en trozos). */
export function cookiesDeSesion(
  sesion: Record<string, unknown>,
  tamanoTrozo?: number,
): { name: string; value: string }[] {
  const valor = "base64-" + stringToBase64URL(JSON.stringify(sesion));
  return createChunks(NOMBRE_COOKIE, valor, tamanoTrozo);
}

export const cabeceraCookie = (cookies: { name: string; value: string }[]) =>
  cookies.map((c) => `${c.name}=${c.value}`).join("; ");
