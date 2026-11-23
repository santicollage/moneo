// F4-04c · Límite de intentos sin base (la atomicidad se prueba contra Postgres en tests/integration).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorApi } from "./http/errores";
import {
  claveCorreo,
  exigirIntento,
  hashClave,
  inicioVentana,
  LIMITES,
  registrarIntento,
  type DependenciasLimite,
} from "./limite";

const LLAVE = "llave-de-prueba-de-32-caracteres-o-mas";
// 2026-11-19 15:07:30 UTC: la ventana de 15 min empieza a las 15:00 y abre la siguiente a las 15:15.
const AHORA = Date.UTC(2026, 10, 19, 15, 7, 30);

/** Contador en memoria con la misma semántica que la sentencia de EN-13. */
function contadorFalso() {
  const filas = new Map<string, number>();
  const llamadas: { scope: string; hash: Uint8Array; inicio: Date }[] = [];
  const incrementar: DependenciasLimite["incrementar"] = async (scope, hash, inicio) => {
    llamadas.push({ scope, hash, inicio });
    const k = `${scope}|${Buffer.from(hash).toString("hex")}|${inicio.toISOString()}`;
    const n = (filas.get(k) ?? 0) + 1;
    filas.set(k, n);
    return n;
  };
  return { incrementar, llamadas };
}

describe("F4-04c límite de intentos (RNF-SEG-02, DN-2)", () => {
  it("los ámbitos caben en scope VARCHAR(32) y sus valores son los de §1.5", () => {
    for (const ambito of Object.keys(LIMITES)) expect(ambito.length).toBeLessThanOrEqual(32);
    expect(LIMITES["login:account"]).toEqual({ maximo: 5, ventanaSegundos: 900 });
    expect(LIMITES["login:ip"]).toEqual({ maximo: 20, ventanaSegundos: 900 });
    expect(LIMITES["invite:accept"]).toEqual({ maximo: 10, ventanaSegundos: 900 });
    expect(LIMITES["recovery:email"]).toEqual({ maximo: 3, ventanaSegundos: 3600 });
  });

  it("ventana fija alineada: 15:07:30 → 15:00:00", () => {
    expect(inicioVentana(AHORA, 900).toISOString()).toBe("2026-11-19T15:00:00.000Z");
    expect(inicioVentana(Date.UTC(2026, 10, 19, 15, 15), 900).toISOString()).toBe(
      "2026-11-19T15:15:00.000Z",
    );
  });

  it("RNF-PRI-01: el hash es un HMAC de 32 bytes, no el SHA-256 del correo, y depende de llave y ámbito", () => {
    const h = hashClave("login:account", "ana@ejemplo.co", LLAVE);
    expect(h.byteLength).toBe(32);
    expect(Buffer.from(h).toString("hex")).not.toBe(
      createHash("sha256").update("ana@ejemplo.co").digest("hex"),
    );
    expect(Buffer.from(h).toString("latin1")).not.toContain("ana");
    expect(hashClave("login:account", "ana@ejemplo.co", LLAVE)).toEqual(h);
    expect(hashClave("login:account", "ana@ejemplo.co", `${LLAVE}x`)).not.toEqual(h);
    expect(hashClave("recovery:email", "ana@ejemplo.co", LLAVE)).not.toEqual(h);
  });

  it("el mismo correo escrito distinto es la misma clave", () => {
    expect(claveCorreo("  Ana@Ejemplo.CO ")).toBe("ana@ejemplo.co");
    // «é» compuesta y descompuesta (NFC).
    expect(claveCorreo("josé@x.co")).toBe(claveCorreo("josé@x.co"));
  });

  it("DN-2: 5 intentos pasan, el 6.º no, y Retry-After es lo que falta para las 15:15", async () => {
    const c = contadorFalso();
    const deps = { llave: () => LLAVE, ahora: () => AHORA, incrementar: c.incrementar };
    const r = [];
    for (let i = 0; i < 6; i++)
      r.push(await registrarIntento("login:account", "ana@ejemplo.co", deps));
    expect(r.map((x) => x.permitido)).toEqual([true, true, true, true, true, false]);
    expect(r[5]).toEqual({ permitido: false, intento: 6, reintentoSegundos: 450 });
    expect(c.llamadas[0]?.scope).toBe("login:account");
    expect(c.llamadas[0]?.inicio.toISOString()).toBe("2026-11-19T15:00:00.000Z");
  });

  it("a los 15 min (reloj inyectado) abre la ventana siguiente", async () => {
    const c = contadorFalso();
    let ahora = AHORA;
    const deps = { llave: () => LLAVE, ahora: () => ahora, incrementar: c.incrementar };
    for (let i = 0; i < 6; i++) await registrarIntento("login:account", "ana@ejemplo.co", deps);
    ahora = AHORA + 7.5 * 60 * 1000; // 15:15:00
    expect((await registrarIntento("login:account", "ana@ejemplo.co", deps)).permitido).toBe(true);
  });

  it("Retry-After nunca es 0, ni en el último milisegundo de la ventana", async () => {
    const c = contadorFalso();
    const fin = Date.UTC(2026, 10, 19, 15, 14, 59, 999);
    const r = await registrarIntento("login:ip", "1.2.3.4", {
      llave: () => LLAVE,
      ahora: () => fin,
      incrementar: c.incrementar,
    });
    expect(r.reintentoSegundos).toBe(1);
  });

  it("exigirIntento: al pasarse lanza ErrorApi too_many_attempts con el Retry-After", async () => {
    const deps = { llave: () => LLAVE, ahora: () => AHORA, incrementar: async () => 11 };
    const err = await exigirIntento("invite:accept", "perfil", deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErrorApi);
    expect(err).toMatchObject({ codigo: "too_many_attempts", reintentoSegundos: 450 });
    await expect(
      exigirIntento("invite:accept", "perfil", { ...deps, incrementar: async () => 10 }),
    ).resolves.toBeUndefined();
  });
});
