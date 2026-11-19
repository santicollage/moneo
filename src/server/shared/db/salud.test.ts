import { describe, expect, it } from "vitest";
import { crearLogger } from "../log";
import { comprobarBase } from "./salud";

const silencioso = crearLogger(() => {});
const cliente = (f: () => Promise<unknown>) => ({ $queryRaw: () => f() });

describe("E-01 comprobarBase", () => {
  it("responde true si SELECT 1 contesta", async () => {
    expect(
      await comprobarBase(
        cliente(async () => [{ "?column?": 1 }]),
        1000,
        silencioso,
      ),
    ).toBe(true);
  });
  it("false si falla, sin lanzar", async () => {
    expect(
      await comprobarBase(
        cliente(async () => {
          throw new Error("ECONNREFUSED");
        }),
        1000,
        silencioso,
      ),
    ).toBe(false);
  });
  it("false si no contesta a tiempo", async () => {
    const t0 = Date.now();
    expect(
      await comprobarBase(
        cliente(() => new Promise(() => {})),
        50,
        silencioso,
      ),
    ).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
