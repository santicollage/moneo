/**
 * F4-03d · Los tiempos límite del rol `moneo_app` (M-4, R44) están puestos Y funcionan.
 * No usa el mundo de prueba: los bloqueos son advisory (no hacen falta filas) y nada se escribe.
 * La prueba contra el pooler real (6543) y el proceso cortado son manuales: tests/pooler-real.
 */
import pg from "pg";
import { describe, expect, it } from "vitest";
import { CODIGOS_TIEMPO, TIEMPOS_ROL } from "@/server/shared/db/tiempos";
import { conexiones } from "./_conexion";

const { app, dueno } = conexiones();
const s = (ms: number) => `${ms / 1000}s`;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const codigo = (e: unknown) => (e as { code?: string }).code ?? String(e);

describe("F4-03d tiempos del rol", () => {
  it("el rol tiene exactamente los tres tiempos del catálogo", async () => {
    const r = await dueno.query<{ setconfig: string[] }>(
      `SELECT setconfig FROM pg_db_role_setting WHERE setrole = 'moneo_app'::regrole`,
    );
    const todos = r.rows.flatMap((f) => f.setconfig).sort();
    expect(todos).toEqual(
      [
        `idle_in_transaction_session_timeout=${s(TIEMPOS_ROL.idleInTransactionMs)}`,
        `lock_timeout=${s(TIEMPOS_ROL.lockTimeoutMs)}`,
        `statement_timeout=${s(TIEMPOS_ROL.statementTimeoutMs)}`,
      ].sort(),
    );
  });

  it("una conexión nueva de moneo_app arranca con esos valores", async () => {
    const r = await app.query<Record<string, string>>(
      `SELECT current_setting('lock_timeout') AS lock,
              current_setting('statement_timeout') AS sentencia,
              current_setting('idle_in_transaction_session_timeout') AS inactivo`,
    );
    expect(r.rows[0]).toEqual({
      lock: s(TIEMPOS_ROL.lockTimeoutMs),
      sentencia: s(TIEMPOS_ROL.statementTimeoutMs),
      inactivo: s(TIEMPOS_ROL.idleInTransactionMs),
    });
  });

  it("lock_timeout vence en ≈ 5 s con 55P03, e idle_in_transaction cierra la conexión a los 10 s", async () => {
    const a = await app.connect();
    const b = await app.connect();
    // `a` (espera con su BEGIN) y `b` (transacción abortada tras el 55P03) también quedan "idle in
    // transaction": el rol las mata a los 10 s, igual que a `inactiva`. Es lo esperado; sin listener,
    // Node lo trataría como excepción no capturada.
    a.on("error", () => undefined);
    b.on("error", () => undefined);
    // Cliente propio: el pool del arnés tiene max 2 y una tercera connect() esperaría para siempre.
    // `conexiones()` ya comprobó que TEST_APP_DATABASE_URL es local.
    const inactiva = new pg.Client({ connectionString: process.env.TEST_APP_DATABASE_URL });
    await inactiva.connect();
    const eventos: string[] = [];
    inactiva.on("error", (e) => eventos.push(codigo(e)));
    try {
      await a.query("BEGIN");
      await a.query("SELECT pg_advisory_xact_lock(4303)");
      await b.query("BEGIN");
      await inactiva.query("BEGIN");
      await inactiva.query("SELECT 1");

      const t0 = Date.now();
      const espera = await b.query("SELECT pg_advisory_xact_lock(4303)").then(
        () => "obtenido",
        (e: unknown) => codigo(e),
      );
      const ms = Date.now() - t0;
      expect(espera).toBe(CODIGOS_TIEMPO.lockNoDisponible);
      expect(ms).toBeGreaterThanOrEqual(TIEMPOS_ROL.lockTimeoutMs - 500);
      expect(ms).toBeLessThan(TIEMPOS_ROL.lockTimeoutMs + 2_000);

      // Completa los 10 s de silencio de `inactiva` (ya pasaron ≈ 5 s mientras b esperaba).
      await dormir(TIEMPOS_ROL.idleInTransactionMs - ms + 1_500);
      const resultado = await inactiva.query("SELECT 1").then(
        () => "viva",
        (e: unknown) => codigo(e),
      );
      expect(resultado).not.toBe("viva");
      expect([...eventos, resultado]).toContain(CODIGOS_TIEMPO.inactivoEnTransaccion);
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      await b.query("ROLLBACK").catch(() => undefined);
      a.release();
      b.release(true);
      await inactiva.end().catch(() => undefined);
    }
  });
});
