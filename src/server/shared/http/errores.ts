/**
 * Traducción de excepciones a códigos del catálogo (F4-04a, R68, `12-diseno-api.md` §1.6).
 *
 * Se lanza `ErrorApi` para todo error esperado. Lo demás pasa por `clasificar`:
 *   - Tiempos límite y conexiones cortadas → `busy` (503 + Retry-After). Postgres ya deshizo la
 *     transacción: reintentar es seguro (con `Idempotency-Key` en `POST /movements`, A-4).
 *   - Todo lo demás → `internal` (500). Nunca se reenvía el mensaje de Postgres ni de Prisma.
 * Cómo llega un SQLSTATE por Prisma 7 + @prisma/adapter-pg (leído en el runtime 7.10.1):
 * `PrismaClientKnownRequestError` con `code` P2010 (consulta cruda) o P2039 (consulta de modelo) y
 * el SQLSTATE en `meta.driverAdapterError.cause.originalCode`. Con `pg` directo, en `code`.
 * No se importan las clases de Prisma: esta capa no puede (ARQ-05) y basta la forma.
 */
import type { CodigoProblema, ExtensionesProblema } from "./problem";

export class ErrorApi extends Error {
  constructor(
    public readonly codigo: CodigoProblema,
    public readonly extensiones?: ExtensionesProblema,
  ) {
    super(codigo);
    this.name = "ErrorApi";
  }
}

/** SQLSTATE que significan «reintenta» (https://www.postgresql.org/docs/17/errcodes-appendix.html). */
const SQLSTATE_REINTENTABLE = new Set([
  "55P03", // lock_not_available (lock_timeout, M-4)
  "57014", // query_canceled (statement_timeout)
  "25P03", // idle_in_transaction_session_timeout
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "57P01", // admin_shutdown (reinicio del servidor o del pooler)
]);
/** Códigos de Prisma reintentables: P2028 (timeout o maxWait de $transaction), P2034 (conflicto). */
const PRISMA_REINTENTABLE = new Set(["P2028", "P2034"]);
/** `kind` del adaptador para un socket cerrado o vencido. */
const KIND_REINTENTABLE = new Set(["ConnectionClosed", "SocketTimeout"]);

/**
 * Errores de `pg` SIN código cuando la conexión ya no sirve (verificado en F4-04a con PG 17: tras
 * 25P03, la siguiente consulta de la transacción falla con «Client has encountered a connection
 * error and is not queryable», y el evento de la conexión con «Connection terminated unexpectedly»).
 * Se compara el mensaje solo para clasificar; el mensaje nunca se registra.
 */
const MENSAJE_CONEXION_PERDIDA =
  /^(Client has encountered a connection error and is not queryable|Connection terminated( unexpectedly)?|Client was closed and is not queryable)$/;

const SQLSTATE = /^[0-9A-Z]{5}$/;
const CODIGO_PRISMA = /^P\d{4}$/;
const NOMBRE = /^[A-Za-z0-9_]{1,40}$/;

type Forma = {
  code?: unknown;
  name?: unknown;
  meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; kind?: unknown } } };
  cause?: { originalCode?: unknown; kind?: unknown };
};

function texto(v: unknown, patron: RegExp): string | undefined {
  return typeof v === "string" && patron.test(v) ? v : undefined;
}

export type Clasificacion = {
  codigo: CodigoProblema;
  extensiones?: ExtensionesProblema;
  /** Para el log: SQLSTATE, código de Prisma o nombre de la clase. Nunca un mensaje. */
  errorCode: string;
  /** `false` para errores esperados: no van a Sentry (F4-04c). */
  inesperado: boolean;
};

export function clasificar(err: unknown): Clasificacion {
  if (err instanceof ErrorApi) {
    return {
      codigo: err.codigo,
      extensiones: err.extensiones,
      errorCode: err.codigo,
      inesperado: false,
    };
  }
  const e = (typeof err === "object" && err !== null ? err : {}) as Forma;
  const causa = e.meta?.driverAdapterError?.cause ?? e.cause;
  // `P2010` también tiene 5 caracteres: un código de Prisma nunca se toma como SQLSTATE.
  const prisma = texto(e.code, CODIGO_PRISMA);
  const sqlstate =
    (prisma ? undefined : texto(e.code, SQLSTATE)) ?? texto(causa?.originalCode, SQLSTATE);
  const kind = typeof causa?.kind === "string" ? causa.kind : undefined;
  const conexionPerdida =
    !sqlstate && !prisma && err instanceof Error && MENSAJE_CONEXION_PERDIDA.test(err.message);
  const errorCode =
    sqlstate ??
    prisma ??
    (conexionPerdida ? "connection_lost" : undefined) ??
    texto(e.name, NOMBRE) ??
    "unknown";

  if (
    conexionPerdida ||
    (sqlstate && SQLSTATE_REINTENTABLE.has(sqlstate)) ||
    (prisma && PRISMA_REINTENTABLE.has(prisma)) ||
    (kind && KIND_REINTENTABLE.has(kind))
  ) {
    // 57014 se reintenta, pero es una consulta lenta: se reporta igual.
    return { codigo: "busy", errorCode, inesperado: sqlstate === "57014" };
  }
  return { codigo: "internal", errorCode, inesperado: true };
}
