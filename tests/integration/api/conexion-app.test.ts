/* eslint-disable no-restricted-syntax --
   F4-04a: mide `maxWait` y el corte por 25P03 con `$transaction` y el pool real del cliente de la app.
   En la app, `$transaction` solo existe en `locks.ts` (ARQ-06). */
/**
 * F4-04a · El cliente de la app (`crearPrisma`) contra el Postgres local como `moneo_app`, con los
 * tiempos del rol de la migración `role_timeouts`:
 *   1. E-01: `SELECT 1` responde; una base inalcanzable da `false` sin lanzar.
 *   2. `maxWait` (3 s) con un pool de 1 conexión ocupada: P2028 → `busy` (pendiente de F4-03d, D7).
 *   3. `lock_timeout` (5 s): 55P03 llega por Prisma y se traduce a `busy`, nunca a `internal`.
 *   4. 25P03: la base mata una conexión inactiva en transacción; el listener de `error` lo registra,
 *      el proceso sigue vivo y el pool se recupera (hallazgo 3 de F4-03d, R68).
 * Imprime las medidas para el runbook (R-12).
 */
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { crearPrisma } from "@/server/shared/db/client";
import type { PrismaClient } from "@/server/shared/db/generated/client";
import { comprobarBase } from "@/server/shared/db/salud";
import { OPCIONES_TRANSACCION, TIEMPOS_ROL } from "@/server/shared/db/tiempos";
import { clasificar } from "@/server/shared/http/errores";
import { crearLogger } from "@/server/shared/log";

const URL_APP = process.env.TEST_APP_DATABASE_URL;
if (!URL_APP)
  throw new Error("TEST_APP_DATABASE_URL no está definida (ver README, «Pruebas de la base»).");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(URL_APP).hostname)) {
  throw new Error("Estas pruebas solo corren contra un Postgres local.");
}
const bd = { url: URL_APP, local: true, ca: undefined };
const silencioso = crearLogger(() => {});
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const medida = (nombre: string, valor: string) => console.info(`[F4-04a] ${nombre}: ${valor}`);

const abiertos: PrismaClient[] = [];
function cliente(log = silencioso, ajustes: { max?: number } = {}) {
  const c = crearPrisma(bd, log, ajustes);
  abiertos.push(c);
  return c;
}
afterAll(async () => {
  await Promise.all(abiertos.map((c) => c.$disconnect()));
});

describe("F4-04a cliente de la app contra Postgres real", () => {
  it("E-01: SELECT 1 como moneo_app responde", async () => {
    expect(await comprobarBase(cliente(), 2_000, silencioso)).toBe(true);
  });

  it("E-01: base inalcanzable → false en ≤ 3 s, sin lanzar", async () => {
    const malo = crearPrisma({ ...bd, url: URL_APP.replace(/:\d+\//, ":1/") }, silencioso);
    abiertos.push(malo);
    const t0 = Date.now();
    expect(await comprobarBase(malo, 2_000, silencioso)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it("maxWait: con la única conexión ocupada, P2028 a los ≈ 3 s → busy", async () => {
    const c = cliente(silencioso, { max: 1 });
    const ocupada = c.$transaction(async (tx) => {
      // pg_sleep devuelve void, que Prisma no deserializa: se envuelve en un SELECT 1.
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(4.5)`;
    }, OPCIONES_TRANSACCION);
    await dormir(300);
    const t0 = Date.now();
    const err: unknown = await c
      .$transaction((tx) => tx.$queryRaw`SELECT 1`, OPCIONES_TRANSACCION)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    const ms = Date.now() - t0;
    medida("maxWait medido", `${ms} ms (configurado ${OPCIONES_TRANSACCION.maxWait} ms)`);
    await ocupada;
    expect(err, "la segunda transacción debió fallar por maxWait").toBeDefined();
    expect((err as { code?: string }).code).toBe("P2028");
    expect(clasificar(err).codigo).toBe("busy");
    expect(ms).toBeGreaterThanOrEqual(OPCIONES_TRANSACCION.maxWait - 300);
    expect(ms).toBeLessThan(OPCIONES_TRANSACCION.maxWait + 1_500);
  });

  it("lock_timeout: 55P03 llega por Prisma y se traduce a busy (nunca internal)", async () => {
    const duenoDelBloqueo = new pg.Client({ connectionString: URL_APP });
    duenoDelBloqueo.on("error", () => {});
    await duenoDelBloqueo.connect();
    try {
      await duenoDelBloqueo.query("BEGIN");
      await duenoDelBloqueo.query("SELECT pg_advisory_xact_lock(7104)");
      const t0 = Date.now();
      const err: unknown = await cliente()
        .$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7104)`.then(
        () => undefined,
        (e: unknown) => e,
      );
      const ms = Date.now() - t0;
      medida("lock_timeout por Prisma", `${ms} ms (configurado ${TIEMPOS_ROL.lockTimeoutMs} ms)`);
      expect(clasificar(err)).toMatchObject({
        codigo: "busy",
        errorCode: "55P03",
        inesperado: false,
      });
      // Tolerancia de 1 s: en Windows con Docker (WSL2) se midió 4655 ms contra 5020 ms en Linux,
      // probablemente por desfase de relojes entre el host y la VM. Esta prueba comprueba la traducción
      // a `busy`; la precisión del tiempo la vigila tiempos-limite.test.ts (F4-03d).
      expect(ms).toBeGreaterThanOrEqual(TIEMPOS_ROL.lockTimeoutMs - 1_000);
    } finally {
      await duenoDelBloqueo.query("ROLLBACK").catch(() => {});
      await duenoDelBloqueo.end();
    }
  });

  it("25P03: el listener registra el error, el proceso sigue y el pool se recupera", async () => {
    const lineas: string[] = [];
    const c = cliente(
      crearLogger((l) => lineas.push(l)),
      { max: 1 },
    );
    const err: unknown = await c
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          await dormir(TIEMPOS_ROL.idleInTransactionMs + 1_500);
          await tx.$queryRaw`SELECT 1`;
        },
        { maxWait: OPCIONES_TRANSACCION.maxWait, timeout: 30_000 },
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    medida("25P03 → error de la transacción", clasificar(err).errorCode);
    expect(clasificar(err).errorCode).toBe("connection_lost");
    medida("25P03 → log", lineas.join(" "));
    expect(err).toBeDefined();
    expect(clasificar(err).codigo).toBe("busy");
    expect(lineas.some((l) => l.includes('"errorCode":"25P03"'))).toBe(true);
    // El pool descarta la conexión muerta y abre otra.
    expect(await comprobarBase(c, 2_000, silencioso)).toBe(true);
  });
});
