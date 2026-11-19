import { describe, expect, it } from "vitest";
import { configPool, POOL } from "./client";
import { OPCIONES_TRANSACCION } from "./tiempos";

const CA = "-----BEGIN CERTIFICATE-----\nMIIabc\n-----END CERTIFICATE-----";

describe("configPool: TLS y pool (seguridad.md §8)", () => {
  it("fuera de local: verify-full con la CA del proyecto", () => {
    const c = configPool({
      url: "postgresql://u:p@db.example:6543/postgres",
      local: false,
      ca: CA,
    });
    expect(c.ssl).toEqual({ ca: CA, rejectUnauthorized: true });
  });

  it("fuera de local sin CA: no arma el pool", () => {
    expect(() =>
      configPool({ url: "postgresql://u:p@db.example/x", local: false, ca: undefined }),
    ).toThrow();
  });

  it("local: sin TLS", () => {
    expect(
      configPool({ url: "postgresql://u:p@127.0.0.1/x", local: true, ca: undefined }).ssl,
    ).toBe(false);
  });

  it("conectar tarda más que maxWait: vence primero maxWait (P2028 → busy)", () => {
    expect(POOL.connectionTimeoutMillis).toBeGreaterThan(OPCIONES_TRANSACCION.maxWait);
  });
});
