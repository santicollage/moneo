/**
 * F4-05b · «Hecho cuando» contra Supabase LOCAL con Mailpit (`pnpm test:auth-local`; manual).
 *
 *   1. Un correo no permitido recibe 202 por E-02 y no se crea usuario ni perfil.
 *   2. Un `signUp` directo con la clave publicable (saltándose E-02) lo rechaza el hook S-7.
 *   3. Confirmación completa: E-02 → correo en Mailpit → E-04 con token_hash por POST → cookie y
 *      perfil creado; el mismo enlace no sirve dos veces; antes de confirmar, E-05 da 403 solo con
 *      la contraseña correcta (con una incorrecta, 401: no revela que la cuenta existe).
 *   4. Recuperación completa (F4-05b-D4): E-08 → correo → E-09 con el token_hash y la contraseña
 *      nueva → cierra las otras sesiones y deja dentro → la vieja ya no entra y la nueva sí; el
 *      enlace no sirve dos veces ni abre sesión por E-04.
 *
 * Usa las funciones de los Route Handlers (`cuenta.ts`) con el Supabase y el Postgres locales de
 * verdad; solo el contador de intentos y el perfil se conectan a mano como `moneo_app`.
 * Requisitos: los de `sesion-real.test.ts` más TEST_APP_DATABASE_URL.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import {
  confirmar,
  entrar,
  recuperar,
  registrar,
  restablecer,
  type DependenciasCuenta,
} from "@/server/shared/auth/cuenta";
import { leerTokens, parseCookieHeader } from "@/server/shared/auth/cookie-sesion";
import { crearVerificadorJwt } from "@/server/shared/auth/verificador-jwt";
import { crearPrisma } from "@/server/shared/db/client";
import { asegurarPerfil } from "@/server/shared/db/perfil";
import { incrementarIntento } from "@/server/shared/db/intentos";
import { ErrorApi } from "@/server/shared/http/errores";
import { exigirIntento, registrarIntento } from "@/server/shared/limite";
import { crearLogger } from "@/server/shared/log";
import {
  cookieDe,
  dueno,
  esperarEnlace,
  permitir,
  quitarPermiso,
  usuariosConCorreo,
} from "./_comun";

const URL_SUPA = process.env.TEST_SUPABASE_URL;
const CLAVE = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const URL_APP = process.env.TEST_APP_DATABASE_URL;
if (!URL_SUPA || !CLAVE || !URL_APP) {
  throw new Error(
    "Faltan TEST_SUPABASE_URL, TEST_SUPABASE_PUBLISHABLE_KEY o TEST_APP_DATABASE_URL.",
  );
}
const ORIGEN = "http://localhost:3000";
const LLAVE = "llave-de-prueba-de-32-caracteres-o-mas";
const CFG = { url: URL_SUPA, clavePublica: CLAVE, cookiesSeguras: false };
const prisma = crearPrisma(
  { url: URL_APP, local: true, ca: undefined },
  crearLogger(() => {}),
);
const verificar = crearVerificadorJwt(() => ({
  emisor: `${URL_SUPA}/auth/v1`,
  claves: createRemoteJWKSet(new URL(`${URL_SUPA}/auth/v1/.well-known/jwks.json`)),
}));

const deps: Partial<DependenciasCuenta> = {
  cfg: () => CFG,
  ip: () => randomUUID(), // cada llamada «desde otra IP»: el límite por IP no interfiere aquí
  log: crearLogger(() => {}),
  asegurarPerfil: (id, nombre) => asegurarPerfil(id, nombre, prisma),
  registrarIntento: (a, c) =>
    registrarIntento(a, c, {
      llave: () => LLAVE,
      incrementar: (s, h, i) => incrementarIntento(s, h, i, prisma),
    }),
  exigirIntento: (a, c) =>
    exigirIntento(a, c, {
      llave: () => LLAVE,
      incrementar: (s, h, i) => incrementarIntento(s, h, i, prisma),
    }),
};

const creados: string[] = [];
const nuevoCorreo = (p: string) => {
  const c = `f405b-${p}-${randomUUID()}@moneo.test`;
  creados.push(c);
  return c;
};
const frase = () => randomBytes(18).toString("base64url"); // 24 caracteres
const pet = (cuerpo: unknown, cookie?: string) => {
  const peticion = new Request(`${ORIGEN}/api/v1/auth/x`, {
    method: "POST",
    headers: { origin: ORIGEN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(cuerpo),
  });
  return { peticion, requestId: randomUUID(), leerJson: () => peticion.json() };
};
async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof ErrorApi) return e.codigo;
    throw e;
  }
}
const perfilDe = async (id: string) =>
  (
    await dueno.query<{ display_name: string }>(`SELECT display_name FROM profile WHERE id = $1`, [
      id,
    ])
  ).rows[0];
const conCookie = (cookie: string) => new Request(`${ORIGEN}/api/v1/me`, { headers: { cookie } });

afterAll(async () => {
  for (const c of creados) await quitarPermiso(c);
  await prisma.$disconnect();
  await dueno.end();
});

describe("F4-05b registro, confirmación y recuperación contra Supabase local", () => {
  it("1. correo NO permitido: 202 por E-02 y no se crea usuario", async () => {
    const correo = nuevoCorreo("no");
    const r = await registrar(
      pet({ email: correo, password: frase(), displayName: "Nadie" }),
      deps,
    );
    expect(r.status).toBe(202);
    expect(await usuariosConCorreo(correo)).toBe(0);
  });

  it("2. signUp directo con la clave publicable: lo rechaza el hook", async () => {
    const correo = nuevoCorreo("directo");
    const supa = createClient(URL_SUPA, CLAVE, { auth: { persistSession: false } });
    const { error } = await supa.auth.signUp({ email: correo, password: frase() });
    expect(error, "el hook S-7 no rechazó el registro directo").not.toBeNull();
    expect(error!.status).toBeGreaterThanOrEqual(400);
    expect(error!.status).toBeLessThan(500);
    expect(await usuariosConCorreo(correo)).toBe(0);
  });

  it("3. confirmación completa, con perfil creado al confirmar (F4-05b-D2)", async () => {
    const correo = nuevoCorreo("si");
    const clave = frase();
    await permitir(correo);
    expect(
      (await registrar(pet({ email: correo, password: clave, displayName: "Ana Prueba" }), deps))
        .status,
    ).toBe(202);
    expect(await usuariosConCorreo(correo)).toBe(1);

    // Antes de confirmar: sin perfil; E-05 con la contraseña mala → 401; con la buena → 403.
    expect(await codigoDe(entrar(pet({ email: correo, password: frase() }), deps))).toBe(
      "invalid_credentials",
    );
    expect(await codigoDe(entrar(pet({ email: correo, password: clave }), deps))).toBe(
      "email_not_confirmed",
    );

    const enlace = await esperarEnlace(correo, "Confirma tu correo");
    expect(enlace.type).toBe("email");
    const r = await confirmar(pet(enlace), deps);
    expect(r.status).toBe(204);
    const cookie = cookieDe(r);
    const s = await verificar(conCookie(cookie));
    expect(s?.correo).toBe(correo);
    expect((await perfilDe(s!.profileId))?.display_name).toBe("Ana Prueba");

    // El mismo enlace no sirve dos veces.
    expect(await codigoDe(confirmar(pet(enlace), deps))).toBe("link_invalid");
    // Y ya puede entrar.
    expect((await entrar(pet({ email: correo, password: clave }), deps)).status).toBe(204);
  });

  it("4. recuperación completa: E-08 → E-09 (token_hash + contraseña) → solo la nueva entra", async () => {
    const correo = nuevoCorreo("rec");
    const vieja = frase();
    const nueva = frase();
    await permitir(correo);
    await registrar(pet({ email: correo, password: vieja, displayName: "Rita" }), deps);
    const vistos = new Set<string>();
    await confirmar(pet(await esperarEnlace(correo, "Confirma tu correo", vistos)), deps);
    // Otra sesión abierta (otro teléfono) que E-09 debe cerrar.
    const otro = await entrar(pet({ email: correo, password: vieja }), deps);
    const cookieOtro = cookieDe(otro);

    expect((await recuperar(pet({ email: correo }), deps)).status).toBe(202);
    const enlace = await esperarEnlace(correo, "Restablece tu contraseña", vistos);
    expect(enlace.type).toBe("recovery");
    // El enlace de recuperación no abre sesión por E-04 (sin gastarlo: falla la validación).
    expect(await codigoDe(confirmar(pet(enlace), deps))).toBe("invalid_request");

    const r = await restablecer(pet({ tokenHash: enlace.tokenHash, password: nueva }), deps);
    expect(r.status).toBe(204);
    const s = await verificar(conCookie(cookieDe(r)));
    expect(s?.correo).toBe(correo);
    expect(
      await codigoDe(restablecer(pet({ tokenHash: enlace.tokenHash, password: frase() }), deps)),
    ).toBe("link_invalid");
    expect(await codigoDe(entrar(pet({ email: correo, password: vieja }), deps))).toBe(
      "invalid_credentials",
    );
    expect((await entrar(pet({ email: correo, password: nueva }), deps)).status).toBe(204);

    // La otra sesión quedó cerrada: su token de refresco ya no sirve (su JWT vive hasta su exp, R57).
    const t = await leerTokens(parseCookieHeader(cookieOtro));
    const supa = createClient(URL_SUPA, CLAVE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ref = await supa.auth.refreshSession({ refresh_token: t!.tokenRefresco! });
    expect(ref.error).not.toBeNull();
  });
});
