/**
 * Cliente de Prisma de la app (F4-04a, ADR-003, S-1, R68).
 *
 * - Se conecta como `moneo_app` por el pooler de TRANSACCIONES (DATABASE_URL, 6543).
 * - TLS `verify-full` fuera de local: CA del proyecto (DATABASE_CA_CERT) y `rejectUnauthorized`;
 *   Node verifica además que el nombre del host coincida con el certificado (`seguridad.md` §8).
 * - Listeners de `error` en el pool y en cada conexión: una conexión que Postgres mata por
 *   `idle_in_transaction_session_timeout` (25P03) emite `error` y, sin listener, tumba el proceso
 *   (hallazgo 3 de F4-03d). Solo se registra el código, nunca el mensaje.
 * - Se crea al primer uso (`db()`), no al importar: `next build` no necesita la base.
 * ARQ-10: aquí solo se importa el TIPO de `pg`; el pool lo crea el adaptador.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { config, type ConfigBaseDatos } from "../config";
import { clasificar } from "../http/errores";
import { logger as loggerPorDefecto, type Logger } from "../log";
import { PrismaClient } from "./generated/client";

/**
 * Pool por instancia de función. Vercel puede atender varias peticiones en la misma instancia;
 * Supavisor multiplexa del otro lado. `connectionTimeoutMillis` > `maxWait` de `$transaction` (3 s):
 * si conectar tarda, vence primero `maxWait` (P2028 → 503 `busy`).
 */
export const POOL = {
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
} as const;

/** `ajustes` solo para pruebas (p. ej. `max: 1` para medir `maxWait`). */
export function configPool(bd: ConfigBaseDatos, ajustes: { max?: number } = {}): PoolConfig {
  if (!bd.local && !bd.ca) throw new Error("Falta la CA de la base fuera de local (verify-full).");
  return {
    connectionString: bd.url,
    ...POOL,
    ...ajustes,
    application_name: "moneo-app",
    ssl: bd.local ? false : { ca: bd.ca, rejectUnauthorized: true },
  };
}

export function crearPrisma(
  bd: ConfigBaseDatos,
  log: Logger = loggerPorDefecto,
  ajustes: { max?: number } = {},
): PrismaClient {
  const adapter = new PrismaPg(configPool(bd, ajustes), {
    onPoolError: (err) => log.error("db_pool_error", { errorCode: clasificar(err).errorCode }),
    onConnectionError: (err) =>
      log.error("db_connection_error", { errorCode: clasificar(err).errorCode }),
  });
  return new PrismaClient({ adapter });
}

// En desarrollo, la recarga en caliente reevalúa el módulo: se reusa el cliente para no abrir pools.
const global_ = globalThis as unknown as { __moneoPrisma?: PrismaClient };

export function db(): PrismaClient {
  global_.__moneoPrisma ??= crearPrisma(config().baseDatos);
  return global_.__moneoPrisma;
}
