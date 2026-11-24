/* eslint-disable no-restricted-syntax --
   F4-05a: `$transaction` solo para deshacer los datos de la prueba de /me (ROLLBACK al final). */
/**
 * F4-05a · MANUAL contra Supabase LOCAL (`pnpm test:auth-local`; ni `pnpm test` ni el CI).
 * Cubre R49: la verificación real de la sesión, con el Auth y el JWKS de verdad, no con dobles.
 *
 *   1. El proyecto local firma con claves ASIMÉTRICAS (EN-11): el JWKS trae claves EC o RSA.
 *   2. El verificador acepta un token real y rechaza el mismo token alterado.
 *   3. El refresco del proxy rota el token de verdad y el nuevo también verifica.
 *   4. E-06 (`local`) invalida el token de refresco de esa sesión; E-07 (`global`) el de todas.
 *   5. `/me` con una sesión real y el perfil en Postgres (si hay TEST_APP_DATABASE_URL).
 *
 * Requisitos: `supabase start` con `signing_keys_path` (ver `.env.example`, «Supabase local»).
 * Desde F4-05b el registro está cerrado por el hook (S-7) y exige confirmar el correo: la prueba
 * agrega su correo a la lista permitida (como dueño), se registra y confirma con el enlace de Mailpit.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { createRemoteJWKSet } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarSesion } from "@/server/shared/auth/cerrar-sesion";
import { clienteConCookies, clienteSinSesion, conSenal } from "@/server/shared/auth/cliente-auth";
import { leerTokens } from "@/server/shared/auth/cookie-sesion";
import { refrescarSiHaceFalta } from "@/server/shared/auth/refresco";
import { ALGORITMOS, crearVerificadorJwt } from "@/server/shared/auth/verificador-jwt";
import { leerMe } from "@/server/perfil/me";
import { crearPrisma } from "@/server/shared/db/client";
import { leerPerfilConMembresias } from "@/server/shared/db/perfil";
import { crearLogger } from "@/server/shared/log";
import { cabeceraCookie, cookiesDeSesion } from "../autorizacion/jwt";
import { dueno, esperarEnlace, permitir, quitarPermiso } from "./_comun";

const URL_SUPA = process.env.TEST_SUPABASE_URL;
const CLAVE = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
if (!URL_SUPA || !CLAVE) {
  throw new Error("Faltan TEST_SUPABASE_URL y TEST_SUPABASE_PUBLISHABLE_KEY (ver .env.example).");
}
if (!["127.0.0.1", "localhost"].includes(new URL(URL_SUPA).hostname)) {
  throw new Error("Esta prueba solo corre contra Supabase local.");
}

const EMISOR = `${URL_SUPA}/auth/v1`;
const JWKS = `${EMISOR}/.well-known/jwks.json`;
const CFG = { url: URL_SUPA, clavePublica: CLAVE, cookiesSeguras: false };
const supa = () =>
  createClient(URL_SUPA, CLAVE, { auth: { persistSession: false, autoRefreshToken: false } });
const verificar = crearVerificadorJwt(() => ({
  emisor: EMISOR,
  claves: createRemoteJWKSet(new URL(JWKS)),
}));
const conCookie = (s: Pick<Session, "access_token" | "refresh_token">, expiresAt?: number) =>
  new Request("http://localhost:3000/api/v1/me", {
    headers: {
      cookie: cabeceraCookie(
        cookiesDeSesion({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: expiresAt,
        }),
      ),
    },
  });

const correo = `f405a-${randomUUID()}@moneo.test`;
const contrasena = randomBytes(18).toString("base64url");
let sesion: Session;

beforeAll(async () => {
  await permitir(correo);
  const { error } = await supa().auth.signUp({ email: correo, password: contrasena });
  if (error) {
    throw new Error(
      `signUp falló (${error.status} ${error.code ?? ""}): ¿hook S-7 y migración aplicados?`,
    );
  }
  const enlace = await esperarEnlace(correo, "Confirma tu correo");
  const v = await supa().auth.verifyOtp({ token_hash: enlace.tokenHash, type: enlace.type });
  if (v.error) throw new Error(`verifyOtp falló (${v.error.status} ${v.error.code ?? ""})`);
  sesion = await iniciar();
});

async function iniciar(): Promise<Session> {
  const { data, error } = await supa().auth.signInWithPassword({
    email: correo,
    password: contrasena,
  });
  if (error || !data.session) throw new Error(`signIn falló (${error?.status})`);
  return data.session;
}

async function refrescoFunciona(tokenRefresco: string): Promise<boolean> {
  const { data, error } = await supa().auth.refreshSession({ refresh_token: tokenRefresco });
  return !error && data.session !== null;
}

describe("F4-05a sesión real contra Supabase local", () => {
  it("EN-11: el JWKS local trae claves asimétricas y ninguna simétrica", async () => {
    const r = await fetch(JWKS);
    expect(r.ok).toBe(true);
    const { keys } = (await r.json()) as { keys: { kty: string; alg?: string }[] };
    expect(
      keys.length,
      "JWKS vacío: el proyecto firma con el secreto HS256 (falta signing_keys_path)",
    ).toBeGreaterThan(0);
    for (const k of keys) {
      expect(["EC", "RSA"]).toContain(k.kty);
      if (k.alg) expect(ALGORITMOS as readonly string[]).toContain(k.alg);
    }
    const [h] = sesion.access_token.split(".");
    const alg = (JSON.parse(Buffer.from(h!, "base64url").toString()) as { alg: string }).alg;
    expect(ALGORITMOS as readonly string[]).toContain(alg);
  });

  it("R49: el verificador acepta el token real y rechaza el mismo token alterado", async () => {
    const s = await verificar(conCookie(sesion));
    expect(s?.profileId).toBe(sesion.user.id);
    expect(s?.correo).toBe(correo);
    expect(s?.amr.map((e) => e.method)).toContain("password");

    const [h, c, f] = sesion.access_token.split(".");
    const otraCarga = JSON.parse(Buffer.from(c!, "base64url").toString()) as Record<
      string,
      unknown
    >;
    otraCarga.sub = randomUUID();
    const alterado = `${h}.${Buffer.from(JSON.stringify(otraCarga)).toString("base64url")}.${f}`;
    expect(await verificar(conCookie({ ...sesion, access_token: alterado }))).toBeNull();
  });

  it("EN-11: el refresco del proxy rota el token de verdad y el nuevo verifica", async () => {
    const s = await iniciar();
    const exp = s.expires_at!;
    const cookies = cookiesDeSesion({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      // Para que auth-js lo dé por vencido sin esperar una hora (margen < 90 s).
      expires_at: Math.floor(Date.now() / 1000) + 30,
    });
    const r = await refrescarSiHaceFalta(cookies, {
      ahoraS: () => exp - 30,
      crearCliente: (f, senal) => clienteConCookies(f, CFG, conSenal(fetch, senal)),
    });
    expect(r.estado).toBe("refrescada");
    if (r.estado !== "refrescada") return;
    const nuevos = await leerTokens(r.cookies.filter((c) => c.value !== ""));
    expect(nuevos?.tokenRefresco).not.toBe(s.refresh_token);
    const v = await verificar(
      conCookie({ access_token: nuevos!.tokenAcceso, refresh_token: nuevos!.tokenRefresco! }),
    );
    expect(v?.profileId).toBe(s.user.id);
  });

  it("EN-9: E-06 (local) invalida el refresco de ESA sesión y no el de otra", async () => {
    const a = await iniciar();
    const b = await iniciar();
    await cerrarSesion(a.access_token, "local", clienteSinSesion(CFG));
    expect(await refrescoFunciona(a.refresh_token)).toBe(false);
    expect(await refrescoFunciona(b.refresh_token)).toBe(true);
  });

  it("EN-9: E-07 (global) invalida el refresco de TODAS las sesiones", async () => {
    const a = await iniciar();
    const b = await iniciar();
    await cerrarSesion(a.access_token, "global", clienteSinSesion(CFG));
    expect(await refrescoFunciona(a.refresh_token)).toBe(false);
    expect(await refrescoFunciona(b.refresh_token)).toBe(false);
  });

  const URL_APP = process.env.TEST_APP_DATABASE_URL;
  it.skipIf(!URL_APP)("E-10: /me con la sesión real y el perfil en Postgres", async () => {
    const prisma = crearPrisma(
      { url: URL_APP!, local: true, ca: undefined },
      crearLogger(() => {}),
    );
    class Deshacer extends Error {}
    try {
      const s = await iniciar();
      const v = await verificar(conCookie(s));
      expect(v).not.toBeNull();
      await prisma.$transaction(async (tx) => {
        await tx.profile.create({ data: { id: v!.profileId, displayName: "Prueba F4-05a" } });
        const me = await leerMe(
          { profileId: v!.profileId, spaceId: null, rol: null },
          v!.correo,
          (p) => leerPerfilConMembresias(p, tx),
        );
        expect(me).toEqual({
          profile: { id: s.user.id, displayName: "Prueba F4-05a", email: correo },
          memberships: [],
        });
        throw new Deshacer();
      });
    } catch (e) {
      if (!(e instanceof Deshacer)) throw e;
    } finally {
      await prisma.$disconnect();
    }
  });
});

afterAll(async () => {
  // El usuario de prueba queda en auth.users local (sin clave secreta no se borra desde aquí).
  // `supabase db reset` lo limpia. La entrada de la lista permitida sí se quita.
  await quitarPermiso(correo);
  await dueno.end();
});
