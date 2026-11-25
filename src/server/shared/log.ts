/**
 * Logger con lista permitida (ADR-011, RNF-PRI-01).
 *
 * El tipo solo admite los campos de la lista; en tiempo de ejecución se vuelve a filtrar todo,
 * porque un `as` o un `any` se saltan el compilador:
 *   - `route` tiene que ser un PATRÓN (`/api/v1/spaces/:spaceId/...`), nunca la ruta real.
 *   - Los campos `*Id` tienen que ser UUID.
 *   - `errorCode` es un código (SQLSTATE, `P2010`, nombre de la clase), nunca un mensaje.
 * Lo que no cumple se descarta y se cuenta en `dropped`, sin su valor.
 */

export type EventoLog =
  | "request"
  | "request_failed"
  | "db_pool_error"
  | "db_connection_error"
  | "db_unreachable"
  | "config_invalid"
  | "session_refresh_failed"
  | "auth_rejected"
  /** F4-05c: el login entró pero no se pudo borrar el contador de fallos de la cuenta. */
  | "login_counter_reset_failed";

export type Nivel = "info" | "warn" | "error";
export type Metodo = "GET" | "POST" | "PATCH" | "PUT";

export type CamposLog = {
  route?: string;
  method?: Metodo;
  status?: number;
  durationMs?: number;
  requestId?: string;
  errorCode?: string;
} & { [id: `${string}Id`]: string | undefined };

export type Logger = {
  info(evento: EventoLog, campos?: CamposLog): void;
  warn(evento: EventoLog, campos?: CamposLog): void;
  error(evento: EventoLog, campos?: CamposLog): void;
};

const EVENTOS = new Set<string>([
  "request",
  "request_failed",
  "db_pool_error",
  "db_connection_error",
  "db_unreachable",
  "config_invalid",
  "session_refresh_failed",
  "auth_rejected",
  "login_counter_reset_failed",
]);
const METODOS = new Set<string>(["GET", "POST", "PATCH", "PUT"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Segmentos en minúscula con guiones, o parámetros `:nombre`. Un UUID no pasa (tiene 5 grupos). */
const PATRON_RUTA = /^\/api\/v1(\/(:[a-zA-Z]+|[a-z][a-z-]{0,39}))*$/;
const CODIGO = /^[A-Za-z0-9_.]{1,40}$/;

/** Filtra un registro contra la lista permitida. Exportado para las pruebas y para Sentry (F4-04c). */
export function filtrar(evento: string, nivel: Nivel, campos: Record<string, unknown> = {}) {
  const salida: Record<string, string | number> = {
    level: nivel,
    event: EVENTOS.has(evento) ? evento : "invalid_event",
  };
  let dropped = 0;
  for (const [clave, valor] of Object.entries(campos)) {
    if (valor === undefined) continue;
    let ok: boolean;
    switch (clave) {
      case "route":
        ok = typeof valor === "string" && PATRON_RUTA.test(valor);
        break;
      case "method":
        ok = typeof valor === "string" && METODOS.has(valor);
        break;
      case "status":
        ok = Number.isInteger(valor) && (valor as number) >= 100 && (valor as number) <= 599;
        break;
      case "durationMs":
        ok = typeof valor === "number" && Number.isFinite(valor) && valor >= 0;
        break;
      case "errorCode":
        ok = typeof valor === "string" && CODIGO.test(valor);
        break;
      default:
        ok = /^[a-z][A-Za-z]*Id$/.test(clave) && typeof valor === "string" && UUID.test(valor);
    }
    if (ok)
      salida[clave] = clave === "durationMs" ? Math.round(valor as number) : (valor as string);
    else dropped++;
  }
  if (dropped > 0) salida.dropped = dropped;
  return salida;
}

export type Salida = (linea: string) => void;

const salidaEstandar: Salida = (linea) => {
  process.stdout.write(`${linea}\n`);
};

export function crearLogger(salida: Salida = salidaEstandar, ahora = () => new Date()): Logger {
  const escribir = (nivel: Nivel) => (evento: EventoLog, campos?: CamposLog) => {
    salida(JSON.stringify({ ts: ahora().toISOString(), ...filtrar(evento, nivel, campos) }));
  };
  return { info: escribir("info"), warn: escribir("warn"), error: escribir("error") };
}

export const logger: Logger = crearLogger();
