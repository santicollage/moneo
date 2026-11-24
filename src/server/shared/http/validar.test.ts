// F4-05b · `validar`: 400 con campo y regla, nunca el valor recibido.
import { describe, expect, it } from "vitest";
import { Login, Registro } from "@/contracts/auth";
import { ErrorApi } from "./errores";
import { validar } from "./validar";

const MARCADOR = "marcador-que-no-debe-salir@moneo.test";
const FRASE = ["quince", "caracteres", "o", "mas"].join("-");

function errorDe(fn: () => unknown): ErrorApi {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorApi) return e;
    throw e;
  }
  throw new Error("no lanzó");
}

describe("validar", () => {
  it("devuelve el valor ya normalizado (correo en minúsculas y sin espacios)", () => {
    const r = validar(Login, { email: "  Ana@Moneo.TEST ", password: "x" });
    expect(r.email).toBe("ana@moneo.test");
  });

  it("rechaza con campo y regla, sin el valor", () => {
    const e = errorDe(() =>
      validar(Registro, { email: MARCADOR, password: "corta", displayName: "Ana" }),
    );
    expect(e.codigo).toBe("invalid_request");
    expect(e.extensiones?.errors).toEqual([{ field: "password", rule: "too_short" }]);
    expect(JSON.stringify(e.extensiones)).not.toContain("corta");
  });

  it("rechaza campos de más (strictObject) y cuerpos que no son objeto", () => {
    expect(
      errorDe(() => validar(Login, { email: "a@moneo.test", password: "x", extra: MARCADOR }))
        .extensiones?.errors?.[0]?.field,
    ).toBe("body");
    expect(errorDe(() => validar(Login, undefined)).codigo).toBe("invalid_request");
  });

  it("DN-1: 15 caracteres mínimo y 72 bytes máximo (una tilde ocupa 2)", () => {
    const ok = (p: string) =>
      Registro.safeParse({ email: "a@moneo.test", password: p, displayName: "A" }).success;
    expect(ok("a".repeat(14))).toBe(false);
    expect(ok("a".repeat(15))).toBe(true);
    expect(ok("a".repeat(72))).toBe(true);
    expect(ok("a".repeat(73))).toBe(false);
    expect(ok("á".repeat(36))).toBe(true); // 72 bytes
    expect(ok("á".repeat(37))).toBe(false); // 74 bytes, aunque son 37 caracteres
    expect(ok(FRASE)).toBe(true);
  });
});
