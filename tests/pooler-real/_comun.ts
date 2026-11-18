/**
 * Arnés MANUAL de F4-03d contra Supabase real (STAGING). No corre en `pnpm test` ni en el CI:
 * `pnpm test:pooler-real`, desde una ventana de PowerShell con las variables de scripts/supabase-real
 * (las mismas de verificar.ps1) más MONEO_ENTORNO=staging.
 *
 * Reglas (inversas a las de tests/integration/db/_conexion.ts, que solo acepta hosts locales):
 *   - Solo hosts *.pooler.supabase.com, con el puerto que corresponde a cada variable.
 *   - MONEO_ENTORNO debe ser "staging": estas pruebas crean y borran filas de fixture con el dueño.
 *   - Los tres usuarios deben ser del mismo proyecto (mismo ref).
 *   - La fixture es un perfil, un espacio y una membresía marcados «f4-03d fixture»; se borran al
 *     empezar (por si una corrida anterior murió) y al terminar. Sin datos reales.
 * TLS: se usa `rejectUnauthorized: false`. Estas pruebas NO prueban el certificado (eso es F4-04).
 */
import pg from "pg";

/** Sentencia de bloqueo de M-4 (la primera de toda escritura financiera), tal cual. */
export const M4 = `SELECT s.id FROM space s
  JOIN membership m ON m.space_id = s.id AND m.profile_id = $1 AND m.ended_at IS NULL
  WHERE s.id = $2 AND s.deleted_at IS NULL
  FOR UPDATE OF s`;

export type Entorno = { ownerUrl: string; appUrl: string; appTxUrl: string };
export type Fixture = { actor: string; espacio: string };

function leer(nombre: string, puerto: string): string {
  const valor = process.env[nombre];
  if (!valor)
    throw new Error(`Falta la variable ${nombre} (ver scripts/supabase-real/verificar.ps1).`);
  const u = new URL(valor);
  if (!u.hostname.endsWith(".pooler.supabase.com")) {
    throw new Error(`${nombre} no apunta al pooler de Supabase (*.pooler.supabase.com).`);
  }
  if (u.port !== puerto) throw new Error(`${nombre} debe usar el puerto ${puerto}.`);
  return valor;
}

export function entorno(): Entorno {
  if (process.env.MONEO_ENTORNO !== "staging") {
    throw new Error('MONEO_ENTORNO debe valer "staging": estas pruebas escriben filas de fixture.');
  }
  const e = {
    ownerUrl: leer("MONEO_OWNER_URL", "5432"),
    appUrl: leer("MONEO_APP_URL", "5432"),
    appTxUrl: leer("MONEO_APP_TX_URL", "6543"),
  };
  const usuarios = [e.ownerUrl, e.appUrl, e.appTxUrl].map((u) =>
    decodeURIComponent(new URL(u).username),
  );
  const [dueno, app, appTx] = usuarios as [string, string, string];
  if (
    !dueno.startsWith("postgres.") ||
    !app.startsWith("moneo_app.") ||
    !appTx.startsWith("moneo_app.")
  ) {
    throw new Error("Los usuarios deben ser postgres.<ref> (dueño) y moneo_app.<ref> (app).");
  }
  if (new Set(usuarios.map((u) => u.split(".")[1])).size !== 1) {
    throw new Error("Las tres URL deben ser del mismo proyecto (mismo ref).");
  }
  return e;
}

export function configPg(url: string, extra: pg.PoolConfig = {}): pg.PoolConfig {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || "postgres",
    ssl: { rejectUnauthorized: false },
    ...extra,
  };
}

export const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const codigoDe = (e: unknown) => (e as { code?: string }).code ?? String(e);

const MARCA = "f4-03d fixture";

async function conDueno<T>(ownerUrl: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client(configPg(ownerUrl));
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function limpiar(c: pg.Client): Promise<void> {
  await c.query(`DELETE FROM membership WHERE space_id IN (SELECT id FROM space WHERE name = $1)`, [
    MARCA,
  ]);
  await c.query(`DELETE FROM space WHERE name = $1`, [MARCA]);
  await c.query(`DELETE FROM profile WHERE display_name = $1`, [MARCA]);
}

export async function crearFixture(ownerUrl: string): Promise<Fixture> {
  return conDueno(ownerUrl, async (c) => {
    await limpiar(c);
    const p = await c.query<{ id: string }>(
      `INSERT INTO profile (id, display_name) VALUES (gen_random_uuid(), $1) RETURNING id`,
      [MARCA],
    );
    const actor = p.rows[0]?.id;
    if (!actor) throw new Error("No se creó el perfil de la fixture");
    const e = await c.query<{ id: string }>(
      `INSERT INTO space (kind, name, created_by_id) VALUES ('shared', $1, $2) RETURNING id`,
      [MARCA, actor],
    );
    const espacio = e.rows[0]?.id;
    if (!espacio) throw new Error("No se creó el espacio de la fixture");
    await c.query(`INSERT INTO membership (space_id, profile_id, role) VALUES ($1, $2, 'owner')`, [
      espacio,
      actor,
    ]);
    return { actor, espacio };
  });
}

export async function retirarFixture(ownerUrl: string): Promise<void> {
  await conDueno(ownerUrl, limpiar);
}

/** Un intento de tomar el bloqueo de M-4 esperando como máximo 300 ms. true = lo obtuvo. */
export async function intentarBloqueo(pool: pg.Pool, f: Fixture): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '300ms'");
    const r = await c.query(M4, [f.actor, f.espacio]);
    await c.query("COMMIT");
    return r.rowCount === 1;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (codigoDe(e) === "55P03") return false;
    throw e;
  } finally {
    c.release();
  }
}

/** Milisegundos desde `desde` hasta que el bloqueo se puede tomar; null si no pasa en `tope`. */
export async function medirLiberacion(
  pool: pg.Pool,
  f: Fixture,
  desde: number,
  tope = 90_000,
): Promise<number | null> {
  while (Date.now() - desde < tope) {
    if (await intentarBloqueo(pool, f)) return Date.now() - desde;
    await dormir(200);
  }
  return null;
}

/** Línea que se copia al runbook. */
export const medida = (nombre: string, valor: string) => console.log(`MEDIDA ${nombre}: ${valor}`);
