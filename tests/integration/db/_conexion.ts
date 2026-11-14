/**
 * Arnés de las pruebas de integración de la base (F4-03b, ADR-008, T-5).
 *
 * Dos conexiones, cada una con su variable:
 *   TEST_APP_DATABASE_URL    → `moneo_app`, el rol con el que corre la app (S-1). Casi todo se prueba así.
 *   TEST_OWNER_DATABASE_URL  → el dueño del esquema (`postgres`). Solo para leer catálogos, para la sonda
 *                              de RLS (§6.2) y para probar lo que ni el dueño puede hacer (M-17).
 *
 * Reglas del arnés:
 *   - Solo hosts locales (localhost, 127.0.0.1, ::1). Estas pruebas crean un esquema de sonda y nunca
 *     deben tocar staging ni producción por un `.env` mal copiado. El script de F5-07 contra staging
 *     es otra cosa y no usa este arnés.
 *   - Cada prueba corre dentro de BEGIN … ROLLBACK (`enTransaccion`): nada queda escrito, no hace falta
 *     limpiar con el dueño y las pruebas no dependen del orden.
 *   - Si falta una variable, la suite FALLA con un mensaje claro: no se omite en silencio.
 */
import pg from "pg";
import { afterAll } from "vitest";

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function urlDe(nombre: "TEST_APP_DATABASE_URL" | "TEST_OWNER_DATABASE_URL"): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(
      `${nombre} no está definida. Las pruebas de integración necesitan un Postgres local con las ` +
        "migraciones aplicadas y `moneo_app` con LOGIN (ver README, «Pruebas de la base»).",
    );
  }
  const host = new URL(valor).hostname;
  if (!HOSTS_LOCALES.has(host)) {
    throw new Error(
      `${nombre} apunta a "${host}". Este arnés solo corre contra un Postgres local; nunca contra ` +
        "staging ni producción.",
    );
  }
  return valor;
}

// BIGINT llega como string (pg no lo convierte para no perder precisión): así se compara con bigint.
export type Conexiones = { app: pg.Pool; dueno: pg.Pool };

/** Pools de la app y del dueño para un archivo de pruebas; se cierran al terminar el archivo. */
export function conexiones(): Conexiones {
  const app = new pg.Pool({ connectionString: urlDe("TEST_APP_DATABASE_URL"), max: 2 });
  const dueno = new pg.Pool({ connectionString: urlDe("TEST_OWNER_DATABASE_URL"), max: 2 });
  afterAll(async () => {
    await Promise.all([app.end(), dueno.end()]);
  });
  return { app, dueno };
}

/** Corre `fn` dentro de una transacción que SIEMPRE se deshace. */
export async function enTransaccion<T>(
  pool: pg.Pool,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

export type ErrorPg = { code: string; constraint: string | undefined; message: string };

/**
 * Ejecuta una sentencia que DEBE fallar y devuelve el error de Postgres. Usa un savepoint para que
 * la transacción siga viva después del error. Si la sentencia pasa, la prueba falla.
 */
export async function errorDe(
  c: pg.PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<ErrorPg> {
  await c.query("SAVEPOINT sonda");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sonda");
    const err = e as { code?: string; constraint?: string; message?: string };
    return { code: err.code ?? "?", constraint: err.constraint, message: err.message ?? "" };
  }
  await c.query("RELEASE SAVEPOINT sonda");
  throw new Error(`Se esperaba un error y la sentencia pasó: ${sql}`);
}

/** Códigos de Postgres que usan las pruebas (https://www.postgresql.org/docs/17/errcodes-appendix.html). */
export const PG = {
  /** permission denied, must be owner, new row violates row-level security policy */
  sinPermiso: "42501",
  violaCheck: "23514",
  violaFk: "23503",
  violaUnico: "23505",
} as const;
