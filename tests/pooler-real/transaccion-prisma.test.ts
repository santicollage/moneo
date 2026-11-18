/* eslint-disable no-restricted-syntax --
   F4-03d: prueba MANUAL del `$transaction` real contra Supabase. En la app solo lo abre
   `locks.ts` (F4-04, ARQ-06); aquí hace falta para medir `timeout` y `maxWait` con el adaptador. */
/**
 * F4-03d · Lo mismo que bloqueo-y-parametros, pero con el cliente de Prisma y @prisma/adapter-pg
 * (lo que usará la app): `$transaction` interactiva con OPCIONES_TRANSACCION por el 6543.
 *   1. 20 transacciones interactivas con la sentencia de M-4 (parametrizada por Prisma) sin error.
 *   2. Si la transacción supera su `timeout`, Prisma la deshace (P2028) y el bloqueo se libera.
 * Requiere el cliente generado: `pnpm exec prisma generate` (necesita DB_OWNER_URL de relleno, R65).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/server/shared/db/generated/client";
import { CODIGOS_TIEMPO, OPCIONES_TRANSACCION, TIEMPOS_ROL } from "@/server/shared/db/tiempos";
import {
  codigoDe,
  configPg,
  crearFixture,
  dormir,
  entorno,
  medida,
  medirLiberacion,
  retirarFixture,
  type Fixture,
} from "./_comun";

const env = entorno();
let f: Fixture;
let prisma: PrismaClient;
let observador: pg.Pool;

beforeAll(async () => {
  f = await crearFixture(env.ownerUrl);
  prisma = new PrismaClient({ adapter: new PrismaPg(configPg(env.appTxUrl, { max: 3 })) });
  observador = new pg.Pool(configPg(env.appTxUrl, { max: 2 }));
});
afterAll(async () => {
  await prisma?.$disconnect();
  await observador?.end();
  await retirarFixture(env.ownerUrl);
});

describe("F4-03d $transaction de Prisma por el 6543", () => {
  it("20 transacciones interactivas con la sentencia de M-4, sin error", async () => {
    for (let i = 0; i < 20; i++) {
      const filas = await prisma.$transaction(
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
            SELECT s.id FROM space s
            JOIN membership m ON m.space_id = s.id AND m.profile_id = ${f.actor}::uuid AND m.ended_at IS NULL
            WHERE s.id = ${f.espacio}::uuid AND s.deleted_at IS NULL
            FOR UPDATE OF s`,
        OPCIONES_TRANSACCION,
      );
      expect(filas, `iteración ${i + 1}`).toHaveLength(1);
    }
    medida("prisma-g3-h7", "20/20");
  });

  it("al vencer el timeout, Prisma deshace la transacción (P2028) y el bloqueo queda libre", async () => {
    const t0 = Date.now();
    const error = await prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT s.id FROM space s
            JOIN membership m ON m.space_id = s.id AND m.profile_id = ${f.actor}::uuid AND m.ended_at IS NULL
            WHERE s.id = ${f.espacio}::uuid FOR UPDATE OF s`;
          await dormir(2_000);
        },
        { maxWait: OPCIONES_TRANSACCION.maxWait, timeout: 500 },
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(codigoDe(error)).toBe(CODIGOS_TIEMPO.prismaTransaccion);
    const ms = await medirLiberacion(observador, f, t0, 30_000);
    medida("prisma-bloqueo-tras-timeout-ms", ms === null ? "NO liberado en 30000 ms" : String(ms));
    expect(ms).not.toBeNull();
    expect(ms as number).toBeLessThanOrEqual(TIEMPOS_ROL.idleInTransactionMs + 3_000);
  });
});
