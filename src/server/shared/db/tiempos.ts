/**
 * Tiempos límite de la capa de base de datos (F4-03d, M-4, R44).
 *
 * Fuente única de los valores. La migración `20261118000000_role_timeouts` los fija en el rol
 * `moneo_app` (con SQL, porque el pooler de transacciones no admite `SET` de sesión) y la prueba
 * `tiempos.test.ts` compara este archivo con esa migración: si cambias uno, cambia el otro.
 *
 * Orden que se debe cumplir (lo verifica la misma prueba):
 *   maxWait < lock_timeout < timeout de $transaction < statement_timeout
 * Así, ante un bloqueo ajeno, primero vence la espera por el bloqueo (reintentable), y Prisma
 * deshace la transacción antes de que la base tenga que matar la sentencia.
 */

/** Valores del rol `moneo_app` en milisegundos. */
export const TIEMPOS_ROL = {
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
  idleInTransactionMs: 10_000,
} as const;

/**
 * Opciones de `$transaction` interactiva. Solo `withSpaceLock` y `withInvitationLock` (F4-04,
 * `locks.ts`) abren transacciones: ellas son las que usan esto.
 * `maxWait`: cuánto esperar una conexión del pool. `timeout`: duración máxima de toda la transacción.
 */
export const OPCIONES_TRANSACCION = {
  maxWait: 3_000,
  timeout: 8_000,
} as const;

/** Códigos de error que estos tiempos producen (https://www.postgresql.org/docs/17/errcodes-appendix.html). */
export const CODIGOS_TIEMPO = {
  /** `lock_timeout` vencido: otra transacción tiene el bloqueo. Reintentable (409/503). */
  lockNoDisponible: "55P03",
  /** `statement_timeout` vencido. */
  sentenciaCancelada: "57014",
  /** `idle_in_transaction_session_timeout`: la base cerró la conexión. */
  inactivoEnTransaccion: "25P03",
  /** Error de Prisma cuando se agota el `timeout` o el `maxWait` de `$transaction`. */
  prismaTransaccion: "P2028",
} as const;
