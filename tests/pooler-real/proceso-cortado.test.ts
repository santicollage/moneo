/**
 * F4-03d · R44: cuánto tiempo queda tomado el bloqueo de M-4 si el cliente desaparece a mitad de la
 * transacción, a través del pooler de transacciones (6543).
 *   A. Proceso MUERTO a la fuerza (SIGKILL): el sistema operativo cierra el socket.
 *   B. Cliente SILENCIOSO: el proceso sigue vivo con el socket abierto y no dice nada. Es lo que pasa
 *      cuando una función de Vercel se congela o la red se cae sin cerrar la conexión, y es el caso en
 *      que `idle_in_transaction_session_timeout` es lo único que libera el bloqueo.
 * Cada caso mide, con un observador por el mismo pooler, cuántos ms pasan hasta poder tomar el bloqueo.
 * MONEO_LINEA_BASE=1 (antes de aplicar la migración): solo mide y anota, sin exigir el tope.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIEMPOS_ROL } from "@/server/shared/db/tiempos";
import {
  M4,
  configPg,
  crearFixture,
  entorno,
  medida,
  medirLiberacion,
  retirarFixture,
  type Fixture,
} from "./_comun";

const env = entorno();
const base = process.env.MONEO_LINEA_BASE === "1";
const MARGEN_MS = 3_000;
const TOPE_MS = 90_000;
const hijoPath = fileURLToPath(new URL("./hijo-transaccion.mjs", import.meta.url));
let f: Fixture;
let observador: pg.Pool;

beforeAll(async () => {
  f = await crearFixture(env.ownerUrl);
  observador = new pg.Pool(configPg(env.appTxUrl, { max: 2 }));
});
afterAll(async () => {
  await observador?.end();
  await retirarFixture(env.ownerUrl);
});

/** Lanza el hijo y espera a que diga BLOQUEADO (ya tiene la transacción abierta y el bloqueo). */
function lanzarHijo(): Promise<ChildProcess> {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(process.execPath, [hijoPath, f.actor, f.espacio], {
      env: { ...process.env, MONEO_APP_TX_URL: env.appTxUrl, M4_SQL: M4 },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const plazo = setTimeout(() => {
      hijo.kill("SIGKILL");
      rechazar(new Error("El hijo no llegó a BLOQUEADO en 30 s"));
    }, 30_000);
    hijo.stdout.on("data", (d: Buffer) => {
      const texto = d.toString();
      if (texto.includes("BLOQUEADO")) {
        clearTimeout(plazo);
        resolver(hijo);
      } else if (texto.includes("SIN_FILA")) {
        clearTimeout(plazo);
        hijo.kill("SIGKILL");
        rechazar(new Error("La fixture no devolvió fila en M-4"));
      }
    });
    hijo.once("error", rechazar);
  });
}

function verificar(nombre: string, ms: number | null) {
  medida(nombre, ms === null ? `NO liberado en ${TOPE_MS} ms` : `${ms} ms`);
  if (base) return;
  expect(ms, "el bloqueo debe liberarse").not.toBeNull();
  expect(ms as number).toBeLessThanOrEqual(TIEMPOS_ROL.idleInTransactionMs + MARGEN_MS);
}

describe("F4-03d proceso cortado a mitad de la transacción (R44)", () => {
  it("A: proceso muerto con SIGKILL", async () => {
    const hijo = await lanzarHijo();
    const t0 = Date.now();
    hijo.kill("SIGKILL");
    verificar("bloqueo-tras-proceso-muerto", await medirLiberacion(observador, f, t0, TOPE_MS));
  });

  it("B: cliente silencioso con el socket abierto", async () => {
    const hijo = await lanzarHijo();
    try {
      const t0 = Date.now();
      verificar(
        "bloqueo-tras-cliente-silencioso",
        await medirLiberacion(observador, f, t0, TOPE_MS),
      );
    } finally {
      hijo.kill("SIGKILL");
    }
  });
});
