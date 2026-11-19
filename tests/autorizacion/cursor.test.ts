import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  codificarCursor,
  decodificarCursor,
  leerLimite,
} from "../../src/server/shared/http/cursor";
import { ErrorApi } from "../../src/server/shared/http/errores";

const valido = {
  occurredOn: "2026-11-19",
  createdAt: "2026-11-19T10:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
};

describe("cursor (A-6)", () => {
  it("ida y vuelta", () => {
    expect(decodificarCursor(codificarCursor(valido))).toEqual(valido);
  });
  it("propiedad: cualquier cadena que no sea un cursor emitido da invalid_cursor", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        try {
          decodificarCursor(s);
        } catch (e) {
          expect(e).toBeInstanceOf(ErrorApi);
          expect((e as ErrorApi).codigo).toBe("invalid_cursor");
        }
      }),
    );
  });
  it.each([
    "",
    "!!!",
    "e30",
    Buffer.from("[1,2,3]").toString("base64url"),
    Buffer.from(JSON.stringify(["2026-13-45", valido.createdAt, valido.id])).toString("base64url"),
    "a".repeat(300),
  ])("rechaza %s", (c) => {
    expect(() => decodificarCursor(c)).toThrow(ErrorApi);
  });
});

describe("limit", () => {
  it("por defecto 50; 1 y 100 valen; 0, 101, 1.5 y letras no", () => {
    expect(leerLimite(null)).toBe(50);
    expect(leerLimite("1")).toBe(1);
    expect(leerLimite("100")).toBe(100);
    for (const x of ["0", "101", "1.5", "-1", "abc", ""])
      expect(() => leerLimite(x)).toThrow(ErrorApi);
  });
});
