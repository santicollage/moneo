/**
 * F4-03d · Los tiempos de `tiempos.ts` y los de la migración del rol son los mismos, y respetan el orden
 * que hace que un bloqueo ajeno se resuelva por el camino reintentable (ver tiempos.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPCIONES_TRANSACCION, TIEMPOS_ROL } from "./tiempos";

const sql = readFileSync(
  new URL(
    "../../../../prisma/migrations/20261118000000_role_timeouts/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

/** Lee `ALTER ROLE moneo_app SET <nombre> = '<n><unidad>'` y devuelve milisegundos. */
function deMigracion(nombre: string): number {
  const m = new RegExp(`^ALTER ROLE moneo_app SET ${nombre} = '(\\d+)(ms|s)';$`, "m").exec(sql);
  if (!m?.[1] || !m[2]) throw new Error(`La migración no fija ${nombre} con el formato esperado`);
  return Number(m[1]) * (m[2] === "s" ? 1000 : 1);
}

describe("F4-03d tiempos límite del rol", () => {
  it("la migración y tiempos.ts fijan los mismos valores", () => {
    expect(deMigracion("lock_timeout")).toBe(TIEMPOS_ROL.lockTimeoutMs);
    expect(deMigracion("statement_timeout")).toBe(TIEMPOS_ROL.statementTimeoutMs);
    expect(deMigracion("idle_in_transaction_session_timeout")).toBe(
      TIEMPOS_ROL.idleInTransactionMs,
    );
  });

  it("la migración no fija ningún otro parámetro del rol", () => {
    const fijados = [...sql.matchAll(/^ALTER ROLE moneo_app SET (\w+) =/gm)].map((m) => m[1]);
    expect(fijados.sort()).toEqual(
      ["idle_in_transaction_session_timeout", "lock_timeout", "statement_timeout"].sort(),
    );
  });

  it("maxWait < lock_timeout < timeout de $transaction < statement_timeout", () => {
    expect(OPCIONES_TRANSACCION.maxWait).toBeLessThan(TIEMPOS_ROL.lockTimeoutMs);
    expect(TIEMPOS_ROL.lockTimeoutMs).toBeLessThan(OPCIONES_TRANSACCION.timeout);
    expect(OPCIONES_TRANSACCION.timeout).toBeLessThan(TIEMPOS_ROL.statementTimeoutMs);
  });
});
