/**
 * Comprobación de la base para E-01 (`GET /api/v1/health`): `SELECT 1` como `moneo_app`.
 * Responde `false` si la base no contesta en `limiteMs` o falla; nunca lanza.
 */
import { clasificar } from "../http/errores";
import { logger as loggerPorDefecto, type Logger } from "../log";
import { db } from "./client";

type ConSelect = { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> };

export const LIMITE_SALUD_MS = 2_000;

export async function comprobarBase(
  cliente: ConSelect = db(),
  limiteMs: number = LIMITE_SALUD_MS,
  log: Logger = loggerPorDefecto,
): Promise<boolean> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<"vencido">((r) => {
    temporizador = setTimeout(() => r("vencido"), limiteMs);
  });
  try {
    const r = await Promise.race([cliente.$queryRaw`SELECT 1`, vencido]);
    if (r === "vencido") {
      log.warn("db_unreachable", { errorCode: "health_timeout" });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("db_unreachable", { errorCode: clasificar(err).errorCode });
    return false;
  } finally {
    clearTimeout(temporizador);
  }
}
