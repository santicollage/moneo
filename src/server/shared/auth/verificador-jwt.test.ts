// F4-05a · EN-11, R49: el verificador acepta solo tokens de Supabase firmados con una clave del JWKS.
import { errors, type JWTPayload } from "jose";
import { describe, expect, it } from "vitest";
import {
  cabeceraCookie,
  claims,
  cookiesDeSesion,
  EMISOR,
  firmar,
  llaves,
  PERFIL,
} from "../../../../tests/autorizacion/jwt";
import { crearVerificadorJwt, verificarToken, type OpcionesVerificador } from "./verificador-jwt";

const AHORA_S = 1_800_000_000;
const ahora = () => new Date(AHORA_S * 1000);

const peticion = (cookie?: string) =>
  new Request("https://app.test/api/v1/me", cookie ? { headers: { cookie } } : {});

async function preparar() {
  const ll = await llaves();
  const o: OpcionesVerificador = { emisor: EMISOR, claves: ll.jwks, ahora };
  const token = (extra: JWTPayload = {}) => firmar(ll.privada, claims(AHORA_S, extra));
  return { ll, o, token };
}

describe("F4-05a verificador JWT (EN-11)", () => {
  it("token válido → sesión con perfil en minúscula, amr y correo", async () => {
    const { o, token } = await preparar();
    const s = await verificarToken(await token({ sub: PERFIL.toUpperCase() }), o);
    expect(s).toEqual({
      profileId: PERFIL,
      amr: [{ method: "password", timestamp: AHORA_S - 10 }],
      correo: "ana@moneo.test",
    });
  });

  it("también acepta RS256 (el algoritmo por defecto de Supabase para claves nuevas)", async () => {
    const ll = await llaves("RS256");
    const t = await firmar(ll.privada, claims(AHORA_S), { alg: "RS256", kid: "k1" });
    expect(await verificarToken(t, { emisor: EMISOR, claves: ll.jwks, ahora })).not.toBeNull();
  });

  it.each<[string, JWTPayload]>([
    ["vencido hace 1 s", { exp: AHORA_S - 1 }],
    ["vence justo ahora", { exp: AHORA_S }],
    ["emitido para el futuro (nbf)", { nbf: AHORA_S + 60 }],
    ["otro emisor (otro proyecto)", { iss: "https://otro.supabase.co/auth/v1" }],
    ["otra audiencia", { aud: "otra" }],
    ["rol anon", { role: "anon" }],
    ["rol service_role", { role: "service_role" }],
    ["usuario anónimo", { is_anonymous: true }],
    ["sub que no es UUID", { sub: "no-es-uuid" }],
    ["sin sub", { sub: undefined }],
    ["sin email", { email: undefined }],
    ["email vacío", { email: "" }],
    ["sin session_id", { session_id: undefined }],
    ["sin exp", { exp: undefined }],
  ])("rechaza: %s", async (_n, extra) => {
    const { o, token } = await preparar();
    expect(await verificarToken(await token(extra), o)).toBeNull();
  });

  it("rechaza un token firmado con otra clave privada (mismo kid)", async () => {
    const { o } = await preparar();
    const ajena = await llaves();
    expect(await verificarToken(await firmar(ajena.privada, claims(AHORA_S)), o)).toBeNull();
  });

  it("rechaza un kid que el JWKS no tiene", async () => {
    const { o, ll } = await preparar();
    const t = await firmar(ll.privada, claims(AHORA_S), { alg: "ES256", kid: "otro" });
    expect(await verificarToken(t, o)).toBeNull();
  });

  it("rechaza HS256 (secreto compartido heredado), aunque la firma sea válida", async () => {
    const { o } = await preparar();
    const compartida = new TextEncoder().encode("MARCADOR-" + "hs256-de-prueba-con-32-bytes!!");
    const t = await firmar(compartida, claims(AHORA_S), { alg: "HS256" });
    expect(await verificarToken(t, o)).toBeNull();
  });

  it("rechaza alg none y basura", async () => {
    const { o } = await preparar();
    const b64 = (x: object) => Buffer.from(JSON.stringify(x)).toString("base64url");
    const sinFirma = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims(AHORA_S))}.`;
    for (const t of [sinFirma, "a.b.c", "", "x"]) {
      expect(await verificarToken(t, o), t).toBeNull();
    }
  });

  it("rechaza la carga alterada después de firmar", async () => {
    const { o, token } = await preparar();
    const [h, , f] = (await token()).split(".");
    const otra = Buffer.from(
      JSON.stringify(claims(AHORA_S, { sub: "11111111-1111-4111-8111-111111111111" })),
    ).toString("base64url");
    expect(await verificarToken(`${h}.${otra}.${f}`, o)).toBeNull();
  });

  it("amr: descarta entradas mal formadas sin rechazar el token", async () => {
    const { o, token } = await preparar();
    const amr = [
      { method: "recovery", timestamp: AHORA_S - 5 },
      { method: 1 },
      "x",
      null,
      { method: "otp", timestamp: "ayer" },
    ];
    expect((await verificarToken(await token({ amr }), o))?.amr).toEqual([
      { method: "recovery", timestamp: AHORA_S - 5 },
    ]);
  });

  it("JWKS caído o inválido → lanza (500), no se disfraza de 401", async () => {
    const { token } = await preparar();
    const t = await token();
    const caido: OpcionesVerificador = {
      emisor: EMISOR,
      ahora,
      claves: () => Promise.reject(new TypeError("fetch failed")),
    };
    await expect(verificarToken(t, caido)).rejects.toThrow(TypeError);
    const lento: OpcionesVerificador = {
      ...caido,
      claves: () => Promise.reject(new errors.JWKSTimeout()),
    };
    await expect(verificarToken(t, lento)).rejects.toBeInstanceOf(errors.JWKSTimeout);
  });
});

describe("F4-05a verificador de peticiones (cookie moneo-sesion)", () => {
  it("sin cookie → null sin resolver opciones (sin configuración ni red)", async () => {
    let resueltas = 0;
    const v = crearVerificadorJwt(() => {
      resueltas++;
      throw new Error("no debería leerse");
    });
    expect(await v(peticion())).toBeNull();
    expect(await v(peticion("otra=1; moneo-sesionx=2"))).toBeNull();
    expect(resueltas).toBe(0);
  });

  it("cookie en un trozo y en varios trozos → misma sesión", async () => {
    const { o, token } = await preparar();
    const v = crearVerificadorJwt(() => o);
    const sesion = { access_token: await token(), refresh_token: "r1", expires_at: AHORA_S + 3600 };
    const entera = cookiesDeSesion(sesion);
    const partida = cookiesDeSesion(sesion, 200);
    expect(entera).toHaveLength(1);
    expect(partida.length).toBeGreaterThan(2);
    const a = await v(peticion(cabeceraCookie(entera)));
    const b = await v(peticion(`otra=1; ${cabeceraCookie(partida)}`));
    expect(a?.profileId).toBe(PERFIL);
    expect(b).toEqual(a);
  });

  it("cookie corrupta o con otra forma → null, nunca lanza", async () => {
    const { o } = await preparar();
    const v = crearVerificadorJwt(() => o);
    for (const valor of [
      "base64-%%%",
      "base64-" + Buffer.from("no json").toString("base64url"),
      "{}",
      '{"access_token":5}',
    ]) {
      expect(await v(peticion(`moneo-sesion=${encodeURIComponent(valor)}`)), valor).toBeNull();
    }
  });
});
