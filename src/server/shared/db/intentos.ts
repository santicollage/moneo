/**
 * Contador de intentos por ventana (EN-13, M-14, RNF-SEG-02, F4-04c).
 *
 * Una sola sentencia: `INSERT … ON CONFLICT … DO UPDATE SET count = count + 1 RETURNING count`.
 * Postgres serializa las inserciones de la misma clave sobre la llave primaria
 * `(scope, key_hash, window_start)`: con N peticiones en paralelo cada una recibe un número distinto
 * de 1 a N, sin «leer y después escribir» que deje pasar a dos con el mismo número.
 *
 * En la misma sentencia se borran las ventanas VENCIDAS de esa misma clave (el índice de la llave
 * primaria empieza por `scope, key_hash`): la tabla no crece por quien vuelve. Las claves que nunca
 * vuelven quedan; con los usuarios de v1 son pocas filas (purga global: Parking lot).
 *
 * `key_hash` llega ya calculado (HMAC, `limite.ts`): aquí nunca entra el correo ni la IP.
 * Vive en `shared/db` y no en un `*.repo.ts` porque no pertenece a un espacio (como `membresias.ts`).
 */
import { db } from "./client";
import type { PrismaClient } from "./generated/client";

/** Lo mínimo del cliente que se usa; permite probar con un cliente propio. */
export type EjecutorIntentos = Pick<PrismaClient, "$queryRaw">;

export async function incrementarIntento(
  scope: string,
  keyHash: Uint8Array<ArrayBuffer>,
  inicioVentana: Date,
  ejecutor: EjecutorIntentos = db(),
): Promise<number> {
  const filas = await ejecutor.$queryRaw<{ count: number }[]>`
    WITH vencidas AS (
      DELETE FROM rate_limit_counter
       WHERE scope = ${scope} AND key_hash = ${keyHash} AND window_start < ${inicioVentana}
    )
    INSERT INTO rate_limit_counter (scope, key_hash, window_start, count)
    VALUES (${scope}, ${keyHash}, ${inicioVentana}, 1)
    ON CONFLICT (scope, key_hash, window_start)
    DO UPDATE SET count = rate_limit_counter.count + 1
    RETURNING count`;
  const fila = filas[0];
  if (!fila) throw new Error("rate_limit_counter: INSERT … RETURNING no devolvió fila");
  return fila.count;
}
