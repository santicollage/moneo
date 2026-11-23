/**
 * La cookie de sesión de Moneo (S-8, EN-11, F4-05a).
 *
 * La escribe `@supabase/ssr` (en el proxy y, desde F4-05b, en login): `base64-` + base64url del
 * JSON de la sesión, partido en trozos `<nombre>.0`, `<nombre>.1`… si no cabe en uno. Con
 * `encode: "tokens-only"` la cookie lleva solo los tokens, no el objeto del usuario (correo y
 * metadatos fuera del navegador: RNF-PRI-03).
 *
 * Aquí solo se LEE, con las utilidades de la misma librería que la escribe: el verificador de
 * sesión no instancia el cliente de Auth (EN-11) y este módulo tampoco.
 */
import {
  combineChunks,
  serializeCookieHeader,
  stringFromBase64URL,
  type CookieOptionsWithName,
} from "@supabase/ssr";
import { z } from "zod";

/** Nombre fijo (también es la `storageKey` de supabase-js): no depende del `ref` del proyecto. */
export const NOMBRE_COOKIE = "moneo-sesion";

const PREFIJO = "base64-";

/** Opciones de la cookie de sesión. `HttpOnly` siempre: el navegador no la necesita (D-06, S-8). */
export function opcionesCookie(seguras: boolean): CookieOptionsWithName {
  return { name: NOMBRE_COOKIE, httpOnly: true, secure: seguras, sameSite: "lax", path: "/" };
}

const esquemaSesion = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_at: z.number().optional(),
});

export type TokensSesion = {
  readonly tokenAcceso: string;
  readonly tokenRefresco: string | undefined;
};

export type CookieLeida = { readonly name: string; readonly value: string };

/** ¿Es la cookie de sesión o uno de sus trozos? (para borrarlas todas al cerrar sesión). */
export function esCookieDeSesion(nombre: string): boolean {
  return nombre === NOMBRE_COOKIE || /^moneo-sesion\.\d+$/.test(nombre);
}

/** Tokens de la cookie de sesión, o `null` si no hay o no tiene la forma esperada. Nunca lanza. */
export async function leerTokens(cookies: readonly CookieLeida[]): Promise<TokensSesion | null> {
  const porNombre = new Map(cookies.map((c) => [c.name, c.value]));
  let crudo: string | null;
  try {
    crudo = await combineChunks(NOMBRE_COOKIE, (n) => porNombre.get(n));
  } catch {
    return null;
  }
  if (!crudo) return null;
  try {
    const json = crudo.startsWith(PREFIJO)
      ? stringFromBase64URL(crudo.slice(PREFIJO.length))
      : crudo;
    const r = esquemaSesion.safeParse(JSON.parse(json));
    if (!r.success) return null;
    return { tokenAcceso: r.data.access_token, tokenRefresco: r.data.refresh_token };
  } catch {
    return null;
  }
}

/**
 * `Set-Cookie` que borran la sesión y todos sus trozos presentes en la petición (cerrar sesión).
 * Mismas opciones con las que se escribió (si no, el navegador no la reemplaza) y `Max-Age=0`.
 */
export function cookiesParaBorrar(cookies: readonly CookieLeida[], seguras: boolean): string[] {
  const { name: _nombre, ...opciones } = opcionesCookie(seguras);
  void _nombre;
  const nombres = new Set(cookies.map((c) => c.name).filter(esCookieDeSesion));
  nombres.add(NOMBRE_COOKIE);
  return [...nombres].sort().map((n) => serializeCookieHeader(n, "", { ...opciones, maxAge: 0 }));
}

/** Las cookies de una petición, sin decodificar (`parseCookieHeader` de la misma librería). */
export { parseCookieHeader } from "@supabase/ssr";
