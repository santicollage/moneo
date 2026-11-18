/**
 * F4-03d · El bloqueo de M-4 por el pooler de TRANSACCIONES de Supabase real (6543), como `moneo_app`.
 *   1. G3-H7: la misma consulta parametrizada 20 veces seguidas, sin error.
 *   2. M-4: con un actor ajeno devuelve 0 filas (la revalidación de membresía).
 *   3. El bloqueo serializa: una segunda transacción espera a que la primera termine.
 *   4. Los tiempos del rol llegan por el pooler y el lock_timeout vence con 55P03 en ≈ 5 s.
 * MONEO_LINEA_BASE=1: mide sin exigir los tiempos del rol (antes de aplicar la migración).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CODIGOS_TIEMPO, TIEMPOS_ROL } from "@/server/shared/db/tiempos";
import {
  M4,
  codigoDe,
  configPg,
  crearFixture,
  dormir,
  entorno,
  medida,
  retirarFixture,
  type Fixture,
} from "./_comun";

const env = entorno();
const base = process.env.MONEO_LINEA_BASE === "1";
let f: Fixture;
let pool: pg.Pool;
let pool2: pg.Pool;

beforeAll(async () => {
  f = await crearFixture(env.ownerUrl);
  pool = new pg.Pool(configPg(env.appTxUrl, { max: 3 }));
  pool2 = new pg.Pool(configPg(env.appTxUrl, { max: 3 }));
});
afterAll(async () => {
  await Promise.all([pool?.end(), pool2?.end()]);
  await retirarFixture(env.ownerUrl);
});

describe("F4-03d bloqueo de M-4 por el 6543", () => {
  it("G3-H7: la sentencia parametrizada 20 veces seguidas, en transacción, sin error", async () => {
    for (let i = 0; i < 20; i++) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await c.query(M4, [f.actor, f.espacio]);
        await c.query("COMMIT");
        expect(r.rowCount, `iteración ${i + 1}`).toBe(1);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    }
    medida("g3-h7-transaccion", "20/20");
  });

  it("G3-H7: lo mismo sin BEGIN explícito (sentencia suelta)", async () => {
    for (let i = 0; i < 20; i++) {
      const r = await pool.query(M4, [f.actor, f.espacio]);
      expect(r.rowCount, `iteración ${i + 1}`).toBe(1);
    }
    medida("g3-h7-suelta", "20/20");
  });

  it("M-4: un actor que no es miembro obtiene 0 filas (404 en la app)", async () => {
    const r = await pool.query(M4, ["00000000-0000-4000-8000-000000000000", f.espacio]);
    expect(r.rowCount).toBe(0);
  });

  it("el bloqueo serializa: B espera a que A termine", async () => {
    const a = await pool.connect();
    const b = await pool2.connect();
    try {
      await a.query("BEGIN");
      await a.query(M4, [f.actor, f.espacio]);
      await b.query("BEGIN");
      await b.query("SET LOCAL lock_timeout = '20s'");
      let obtuvo = false;
      const t0 = Date.now();
      const espera = b.query(M4, [f.actor, f.espacio]).then(() => {
        obtuvo = true;
      });
      await dormir(1_500);
      expect(obtuvo, "B no debe obtenerlo mientras A lo tiene").toBe(false);
      await a.query("COMMIT");
      await espera;
      const ms = Date.now() - t0;
      await b.query("COMMIT");
      expect(ms).toBeGreaterThanOrEqual(1_400);
      medida("espera-serializada-ms", String(ms));
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      await b.query("ROLLBACK").catch(() => undefined);
      a.release();
      b.release();
    }
  });

  it("los tiempos del rol llegan por el pooler (10 sentencias sueltas)", async (ctx) => {
    const vistos = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const r = await pool.query<{ v: string }>(
        `SELECT current_setting('lock_timeout') || '/' || current_setting('statement_timeout') || '/' ||
                current_setting('idle_in_transaction_session_timeout') AS v`,
      );
      vistos.add(r.rows[0]?.v ?? "?");
      await dormir(150);
    }
    medida("tiempos-por-6543 (lock/sentencia/inactivo)", [...vistos].join(" | "));
    if (base) ctx.skip();
    const s = (ms: number) => `${ms / 1000}s`;
    expect([...vistos]).toEqual([
      `${s(TIEMPOS_ROL.lockTimeoutMs)}/${s(TIEMPOS_ROL.statementTimeoutMs)}/${s(TIEMPOS_ROL.idleInTransactionMs)}`,
    ]);
  });

  it("lock_timeout del rol: B recibe 55P03 en ≈ 5 s sin fijar nada en la sesión", async (ctx) => {
    if (base) ctx.skip();
    const a = await pool.connect();
    const b = await pool2.connect();
    try {
      await a.query("BEGIN");
      await a.query(M4, [f.actor, f.espacio]);
      await b.query("BEGIN");
      const t0 = Date.now();
      const resultado = await b.query(M4, [f.actor, f.espacio]).then(
        () => "obtenido",
        (e: unknown) => codigoDe(e),
      );
      const ms = Date.now() - t0;
      medida("lock-timeout-vence-ms", String(ms));
      expect(resultado).toBe(CODIGOS_TIEMPO.lockNoDisponible);
      expect(ms).toBeGreaterThanOrEqual(TIEMPOS_ROL.lockTimeoutMs - 500);
      expect(ms).toBeLessThan(TIEMPOS_ROL.lockTimeoutMs + 2_000);
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      await b.query("ROLLBACK").catch(() => undefined);
      a.release();
      b.release();
    }
  });
});
