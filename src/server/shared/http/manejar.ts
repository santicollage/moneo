/**
 * Envoltura de todo Route Handler de `/api/v1` (F4-04a). Hace, en este orden (T-2):
 *   1. `requestId` nuevo (vuelve en `X-Request-Id`; ADR-011).
 *   2. `Origin` igual a APP_ORIGIN en todo lo que no es GET → si no, 403 `origin_mismatch` (RNF-SEG-07).
 *   3. `Content-Length` > 16 KB → 413 (A §1.5). Un cuerpo sin esa cabecera se corta al leerlo.
 *   4. El manejador. Sesión y política (`withPolicy`, F4-04b) van DENTRO, antes de leer el cuerpo.
 *   5. Cualquier excepción → `clasificar` → `problem+json`, sin mensajes internos.
 *   6. Cabeceras de seguridad y `Cache-Control: no-store` en toda respuesta.
 *   7. Una línea de log por petición con la ruta como patrón (nunca la real).
 * Las dependencias se inyectan para probar sin servidor ni base (T-5).
 */
import { config } from "../config";
import { logger as loggerPorDefecto, type Logger, type Metodo } from "../log";
import { CABECERAS_API } from "./cabeceras";
import { clasificar, ErrorApi } from "./errores";
import { respuestaProblema } from "./problem";

export const CUERPO_MAXIMO = 16 * 1024;

export type DefRuta = {
  /** Patrón de la ruta, con parámetros como `:spaceId`. Es lo único que llega al log. */
  ruta: `/api/v1${string}`;
  metodo: Metodo;
};

export type Contexto = {
  requestId: string;
  peticion: Request;
  /** Lee el cuerpo como JSON con el tope de 16 KB. Cuerpo vacío → `undefined`. */
  leerJson(): Promise<unknown>;
};

export type Manejador = (ctx: Contexto) => Promise<Response>;

/** Hook para reportar errores inesperados (Sentry, F4-04c). Recibe solo códigos e ids. */
export type Reportar = (
  err: unknown,
  datos: { requestId: string; ruta: string; errorCode: string },
) => void;

export type Dependencias = {
  appOrigin: () => string;
  log: Logger;
  ahora: () => number;
  nuevoId: () => string;
  reportar?: Reportar;
};

const porDefecto: Dependencias = {
  appOrigin: () => config().appOrigin,
  log: loggerPorDefecto,
  ahora: () => performance.now(),
  nuevoId: () => crypto.randomUUID(),
};

async function leerConTope(peticion: Request): Promise<unknown> {
  const tipo = peticion.headers.get("content-type") ?? "";
  if (!peticion.body) return undefined;
  const lector = peticion.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > CUERPO_MAXIMO) {
      await lector.cancel();
      throw new ErrorApi("payload_too_large");
    }
    partes.push(value);
  }
  if (total === 0) return undefined;
  if (!/^application\/(problem\+)?json\b/i.test(tipo)) {
    throw new ErrorApi("invalid_request", {
      errors: [{ field: "body", rule: "content_type_json" }],
    });
  }
  const bytes = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    bytes.set(p, i);
    i += p.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ErrorApi("invalid_request", { errors: [{ field: "body", rule: "invalid_json" }] });
  }
}

function conCabeceras(res: Response, requestId: string): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of CABECERAS_API) headers.set(k, v);
  headers.set("X-Request-Id", requestId);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function manejar(def: DefRuta, fn: Manejador, deps: Partial<Dependencias> = {}) {
  const d: Dependencias = { ...porDefecto, ...deps };

  return async function handler(peticion: Request): Promise<Response> {
    const requestId = d.nuevoId();
    const inicio = d.ahora();
    let respuesta: Response;
    let errorCode: string | undefined;

    try {
      if (def.metodo !== "GET" && peticion.headers.get("origin") !== d.appOrigin()) {
        throw new ErrorApi("origin_mismatch");
      }
      const largo = peticion.headers.get("content-length");
      if (largo !== null && !(Number(largo) <= CUERPO_MAXIMO)) {
        throw new ErrorApi("payload_too_large");
      }
      let leido = false;
      respuesta = await fn({
        requestId,
        peticion,
        leerJson: () => {
          if (leido) throw new Error("leerJson() se llamó dos veces");
          leido = true;
          return leerConTope(peticion);
        },
      });
    } catch (err) {
      const c = clasificar(err);
      errorCode = c.errorCode;
      respuesta = respuestaProblema(c.codigo, requestId, c.extensiones);
      if (c.inesperado) {
        d.log.error("request_failed", {
          route: def.ruta,
          method: def.metodo,
          requestId,
          errorCode,
        });
        try {
          d.reportar?.(err, { requestId, ruta: def.ruta, errorCode });
        } catch {
          // Un fallo del reporte nunca cambia la respuesta.
        }
      }
    }

    const final = conCabeceras(respuesta, requestId);
    d.log.info("request", {
      route: def.ruta,
      method: def.metodo,
      status: final.status,
      durationMs: d.ahora() - inicio,
      requestId,
      errorCode,
    });
    return final;
  };
}
