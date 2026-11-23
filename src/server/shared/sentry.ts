/**
 * Errores inesperados hacia Sentry, sin SDK (O-7, R53, RNF-PRI-01, F4-04c-D1).
 *
 * Por qué sin SDK: el de Node trae OpenTelemetry e integraciones automáticas (breadcrumbs con la URL
 * real, la petición, variables locales…) que habría que apagar una por una, decenas de dependencias
 * que Dependabot no actualiza (R62) y peso en el arranque en frío. Aquí el evento se ARMA desde cero
 * con una lista permitida, igual que el log: no hay nada que «limpiar» porque nada entra sin pasar
 * por `filtrar()` de `log.ts`.
 *
 * Lo que sale, y nada más:
 *   - `tags`: lo que `filtrar()` deja de { route (patrón), method, requestId, errorCode }.
 *   - `exception`: `type` = `errorCode` (SQLSTATE, código de Prisma o nombre de clase) y los marcos
 *     de la pila (archivo relativo, función, línea, columna) que pasan sus patrones. Nunca el mensaje
 *     del error (Postgres pone valores en él: `Key (email)=(…)`), ni sus propiedades, ni su `cause`.
 *   - `environment`, `release` (SHA), `event_id`, `timestamp`, `platform`, `level`, `fingerprint`.
 * Sin `request`, `user`, `contexts`, `extra`, `breadcrumbs` ni `server_name`.
 *
 * Protocolo: envelope a `https://<host>/api/<proyecto>/envelope/` (`config.ts` lo saca del DSN) con
 * `X-Sentry-Auth` (sentry_version=7). Se espera la respuesta con un tope de 2 s: en Vercel la función
 * se congela al responder y un envío sin esperar se pierde. Un fallo del envío nunca lanza.
 */
import { config, type ConfigSentry, type Entorno } from "./config";
import { filtrar, type Metodo } from "./log";

export type DatosReporte = { requestId: string; ruta: string; errorCode: string; metodo?: Metodo };

export type Marco = {
  filename: string;
  function?: string;
  lineno: number;
  colno: number;
  in_app: boolean;
};

export type EventoSentry = {
  event_id: string;
  timestamp: number;
  platform: "node";
  level: "error";
  environment: Entorno;
  release?: string;
  tags: Record<string, string>;
  fingerprint: string[];
  exception: { values: [{ type: string; stacktrace?: { frames: Marco[] } }] };
};

export const MAXIMO_MARCOS = 30;

/** `    at fn (archivo:1:2)` o `    at archivo:1:2`. La primera línea de `stack` (el mensaje) nunca cuadra. */
const LINEA_PILA = /^\s+at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
/** Nombres de función de código: identificadores, puntos, `<anonymous>`, `new`, `async`. Sin espacios raros. */
const FUNCION = /^(?:(?:async|new) )?[\w$.<>[\]]{1,100}$/;
/** Ruta de archivo sin espacios ni comillas; las rutas absolutas se recortan antes (`relativo`). */
const ARCHIVO = /^(?:node:)?[\w$@.\-/[\]()]{1,200}$/;

/**
 * Deja la ruta desde `.next/`, `src/` o `node_modules/`: una ruta absoluta lleva el usuario del
 * equipo (`C:\Users\…`) o el de Vercel. Si no hay ninguno de esos tramos, solo el nombre del archivo.
 */
function relativo(archivo: string): string {
  if (/^node:[\w/]+$/.test(archivo)) return archivo; // módulos internos de Node
  const limpio = archivo.replace(/^file:\/\//, "").replaceAll("\\", "/");
  const m = /(?:^|\/)((?:\.next|src|node_modules)\/.*)$/.exec(limpio);
  return m?.[1] ?? limpio.slice(limpio.lastIndexOf("/") + 1);
}

/** Marcos de `err.stack` en el orden de Sentry (el más antiguo primero). Lo que no cuadra, se omite. */
export function marcosDe(err: unknown): Marco[] {
  if (!(err instanceof Error) || typeof err.stack !== "string") return [];
  // `stack` empieza con «Nombre: mensaje», y el mensaje puede tener saltos de línea que imiten un
  // marco («\n    at dato (x:1:2)»). Se quita ese encabezado exacto; si no coincide (alguien cambió
  // el mensaje después de crear el error), no se manda ningún marco.
  let encabezado: string;
  try {
    encabezado = String(err);
  } catch {
    return [];
  }
  if (!err.stack.startsWith(encabezado)) return [];
  const pila = err.stack.slice(encabezado.length);
  const marcos: Marco[] = [];
  for (const linea of pila.split("\n")) {
    const m = LINEA_PILA.exec(linea);
    if (!m) continue;
    const [, funcion, archivoCrudo = "", lineno = "", colno = ""] = m;
    const filename = relativo(archivoCrudo);
    if (!ARCHIVO.test(filename)) continue;
    const marco: Marco = {
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !filename.startsWith("node_modules/") && !filename.startsWith("node:"),
    };
    if (funcion && FUNCION.test(funcion)) marco.function = funcion;
    marcos.push(marco);
    if (marcos.length >= MAXIMO_MARCOS) break;
  }
  return marcos.reverse();
}

export type Contexto = { entorno: Entorno; version: string | undefined };

/** Arma el evento SOLO con campos de la lista permitida. Función pura: es lo que prueba RNF-PRI-01. */
export function construirEvento(
  err: unknown,
  datos: DatosReporte,
  ctx: Contexto,
  ahoraMs: number,
  nuevoId: () => string,
): EventoSentry {
  const campos = filtrar("request_failed", "error", {
    route: datos.ruta,
    method: datos.metodo,
    requestId: datos.requestId,
    errorCode: datos.errorCode,
  });
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(campos)) {
    if (k !== "level" && k !== "event") tags[k] = String(v);
  }
  // `errorCode` ya pasó el patrón de `filtrar`; si no, un valor fijo.
  const tipo = tags.errorCode ?? "unknown";
  const marcos = marcosDe(err);
  const evento: EventoSentry = {
    event_id: nuevoId().replaceAll("-", "").toLowerCase(),
    timestamp: Math.floor(ahoraMs) / 1000,
    platform: "node",
    level: "error",
    environment: ctx.entorno,
    tags,
    fingerprint: [tipo, tags.route ?? "sin_ruta"],
    exception: {
      values: [marcos.length > 0 ? { type: tipo, stacktrace: { frames: marcos } } : { type: tipo }],
    },
  };
  if (ctx.version) evento.release = ctx.version;
  return evento;
}

/** Envelope: cabecera, cabecera del ítem y el evento, una línea JSON cada uno. */
export function serializarEnvelope(
  evento: EventoSentry,
  destino: ConfigSentry,
  ahoraMs: number,
): string {
  const cabecera = {
    event_id: evento.event_id,
    sent_at: new Date(ahoraMs).toISOString(),
    dsn: destino.dsn,
  };
  return `${JSON.stringify(cabecera)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(evento)}\n`;
}

export type Enviar = (url: string, init: RequestInit) => Promise<Response>;

export type OpcionesReportero = {
  destino: ConfigSentry;
  contexto: Contexto;
  enviar?: Enviar;
  ahora?: () => number;
  nuevoId?: () => string;
  topeMs?: number;
};

export const CLIENTE = "moneo-envelope/1.0";

/** Reportero para el hook `reportar` de `manejar()`. Nunca lanza; espera el envío con tope. */
export function crearReportero(o: OpcionesReportero) {
  const enviar = o.enviar ?? ((url, init) => fetch(url, init));
  const ahora = o.ahora ?? (() => Date.now());
  const nuevoId = o.nuevoId ?? (() => crypto.randomUUID());
  const topeMs = o.topeMs ?? 2_000;

  return async function reportar(err: unknown, datos: DatosReporte): Promise<void> {
    try {
      const t = ahora();
      const evento = construirEvento(err, datos, o.contexto, t, nuevoId);
      const res = await enviar(o.destino.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=${CLIENTE}, sentry_key=${o.destino.clavePublica}`,
        },
        body: serializarEnvelope(evento, o.destino, t),
        signal: AbortSignal.timeout(topeMs),
      });
      // El cuerpo de la respuesta no se lee ni se registra.
      await res.body?.cancel();
    } catch {
      // Sentry caído, tope vencido o red: el error ya quedó en el log (`request_failed`).
    }
  };
}

let reportero: ReturnType<typeof crearReportero> | null | undefined;

/** Reportero del proceso según la configuración; `null` si no hay `SENTRY_DSN` (local, CI). */
export function reporteroPorDefecto(): ReturnType<typeof crearReportero> | null {
  if (reportero === undefined) {
    const c = config();
    reportero = c.sentry
      ? crearReportero({ destino: c.sentry, contexto: { entorno: c.entorno, version: c.version } })
      : null;
  }
  return reportero;
}
