/**
 * Cursor de paginación (A-6, F4-04b). Opaco y SIN firma: base64url de
 * `[occurred_on, created_at, id]`. No concede acceso a nada: la consulta siempre filtra por
 * `spaceId` de la ruta, así que un cursor manipulado solo cambia dónde empieza la página.
 * Cualquier cosa que no encaje → 400 `invalid_cursor`.
 */
import { z } from "zod";
import { ErrorApi } from "./errores";

export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 100;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const esquema = z.tuple([z.string().regex(FECHA), z.iso.datetime({ offset: true }), z.uuid()]);

export type Cursor = { occurredOn: string; createdAt: string; id: string };

export function codificarCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.occurredOn, c.createdAt, c.id]), "utf8").toString(
    "base64url",
  );
}

export function decodificarCursor(texto: string): Cursor {
  const invalido = () => new ErrorApi("invalid_cursor");
  if (texto.length === 0 || texto.length > 256 || !/^[A-Za-z0-9_-]+$/.test(texto)) throw invalido();
  try {
    const json: unknown = JSON.parse(Buffer.from(texto, "base64url").toString("utf8"));
    const r = esquema.safeParse(json);
    if (!r.success) throw invalido();
    const [occurredOn, createdAt, id] = r.data;
    if (Number.isNaN(Date.parse(`${occurredOn}T00:00:00Z`))) throw invalido();
    return { occurredOn, createdAt, id };
  } catch (e) {
    throw e instanceof ErrorApi ? e : invalido();
  }
}

/** `limit` de la query: ausente → 50; 1..100 entero; otra cosa → 400 `invalid_request`. */
export function leerLimite(crudo: string | null): number {
  if (crudo === null) return LIMITE_POR_DEFECTO;
  if (!/^\d{1,3}$/.test(crudo)) throw limiteInvalido();
  const n = Number(crudo);
  if (n < 1 || n > LIMITE_MAXIMO) throw limiteInvalido();
  return n;
}

function limiteInvalido(): ErrorApi {
  return new ErrorApi("invalid_request", { errors: [{ field: "limit", rule: "range_1_100" }] });
}
