/**
 * Mundo mínimo para las pruebas de la base, insertado COMO `moneo_app` dentro de la transacción de
 * la prueba (se deshace al final). No es el `buildWorld()` de F5-01 (5 sujetos, dominio): solo lo
 * necesario para que cada FK y cada CHECK tenga contra qué chocar.
 *
 *   Espacio A (compartido): Ana propietaria; cuentas Nequi (compartida) y Caja (de Ana);
 *                           categoría Mercado (necesidades) con subcategoría Frutas;
 *                           asignación de feb-2026; gasto, transferencia y auditoría.
 *   Espacio B (compartido): Beto propietario; cuenta y categoría propias (para referencias cruzadas).
 *
 * Fechas fijas en el pasado: los CHECK de M-19 rechazan fechas posteriores al día real en Bogotá.
 */
import type pg from "pg";

export type Mundo = {
  ana: string;
  beto: string;
  espacioA: string;
  espacioB: string;
  membresiaAna: string;
  nequiA: string;
  cajaA: string;
  mercadoA: string;
  frutasA: string;
  asignacionA: string;
  gastoA: string;
  transferenciaA: string;
  invitacionA: string;
  auditoriaA: string;
  cuentaB: string;
  mercadoB: string;
  frutasB: string;
};

async function id(c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<string> {
  const r = await c.query<{ id: string }>(sql, params);
  const fila = r.rows[0];
  if (!fila) throw new Error(`La fábrica no devolvió id: ${sql}`);
  return fila.id;
}

export async function crearMundo(c: pg.PoolClient): Promise<Mundo> {
  const perfil = `INSERT INTO profile (id, display_name) VALUES (gen_random_uuid(), $1) RETURNING id`;
  const ana = await id(c, perfil, ["Ana"]);
  const beto = await id(c, perfil, ["Beto"]);

  const espacio = `INSERT INTO space (kind, name, created_by_id) VALUES ('shared', $1, $2) RETURNING id`;
  const espacioA = await id(c, espacio, ["Casa A", ana]);
  const espacioB = await id(c, espacio, ["Casa B", beto]);

  const membresia = `INSERT INTO membership (space_id, profile_id, role) VALUES ($1, $2, 'owner') RETURNING id`;
  const membresiaAna = await id(c, membresia, [espacioA, ana]);
  await id(c, membresia, [espacioB, beto]);

  const cuenta = `INSERT INTO account (space_id, name, type, holder_kind, holder_profile_id, opened_on,
                    opening_balance_cents, created_by_id, updated_by_id)
                  VALUES ($1, $2, $3, $4, $5, '2026-01-01', $6, $7, $7) RETURNING id`;
  const nequiA = await id(c, cuenta, [espacioA, "Nequi", "wallet", "shared", null, "50000", ana]);
  const cajaA = await id(c, cuenta, [espacioA, "Caja", "savings", "member", ana, "0", ana]);
  const cuentaB = await id(c, cuenta, [
    espacioB,
    "Bancolombia",
    "savings",
    "shared",
    null,
    "0",
    beto,
  ]);

  const categoria = `INSERT INTO category (space_id, "group", name, name_key, created_by_id, updated_by_id)
                     VALUES ($1, 'needs', 'Mercado', 'mercado', $2, $2) RETURNING id`;
  const mercadoA = await id(c, categoria, [espacioA, ana]);
  const mercadoB = await id(c, categoria, [espacioB, beto]);

  const subcategoria = `INSERT INTO subcategory (space_id, category_id, name, name_key, created_by_id, updated_by_id)
                        VALUES ($1, $2, 'Frutas', 'frutas', $3, $3) RETURNING id`;
  const frutasA = await id(c, subcategoria, [espacioA, mercadoA, ana]);
  const frutasB = await id(c, subcategoria, [espacioB, mercadoB, beto]);

  const asignacionA = await id(
    c,
    `INSERT INTO allocation (space_id, category_id, period, amount_cents, created_by_id, updated_by_id)
     VALUES ($1, $2, '2026-02-01', 30000, $3, $3) RETURNING id`,
    [espacioA, mercadoA, ana],
  );

  const gastoA = await id(
    c,
    `INSERT INTO movement (space_id, kind, direction, amount_cents, account_id, category_id, subcategory_id,
       occurred_on, created_by_id, updated_by_id)
     VALUES ($1, 'expense', 'outflow', 12000, $2, $3, $4, '2026-02-10', $5, $5) RETURNING id`,
    [espacioA, nequiA, mercadoA, frutasA, ana],
  );
  const transferenciaA = await id(
    c,
    `INSERT INTO movement (space_id, kind, direction, amount_cents, account_id, counter_account_id,
       occurred_on, created_by_id, updated_by_id)
     VALUES ($1, 'transfer', NULL, 5000, $2, $3, '2026-02-11', $4, $4) RETURNING id`,
    [espacioA, nequiA, cajaA, ana],
  );

  // token_hash de 32 bytes (CHECK invitation_hash_len); sin pgcrypto: dos md5 en hex.
  const invitacionA = await id(
    c,
    `INSERT INTO invitation (space_id, token_hash, created_by_id, expires_at)
     VALUES ($1, decode(md5(random()::text) || md5(random()::text), 'hex'), $2, now() + interval '72 hours')
     RETURNING id`,
    [espacioA, ana],
  );

  const auditoriaA = await id(
    c,
    `INSERT INTO audit_event (space_id, actor_id, entity, entity_id, action, changes)
     VALUES ($1, $2, 'movement', $3, 'create', '{}'::jsonb) RETURNING id`,
    [espacioA, ana, gastoA],
  );

  return {
    ana,
    beto,
    espacioA,
    espacioB,
    membresiaAna,
    nequiA,
    cajaA,
    mercadoA,
    frutasA,
    asignacionA,
    gastoA,
    transferenciaA,
    invitacionA,
    auditoriaA,
    cuentaB,
    mercadoB,
    frutasB,
  };
}
