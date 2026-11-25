/**
 * S-1 · Lo que `moneo_app` puede y no puede hacer (seguridad.md §6.3).
 *
 * Son las 39 comprobaciones de F3-03 (verificadas a mano en PG 16.15) convertidas en pruebas, más
 * algunas que entonces no se probaron (TRUNCATE en todas, SET ROLE, darse BYPASSRLS).
 * El manifiesto (manifiesto.test.ts) mira los catálogos; esta prueba mira el COMPORTAMIENTO: un
 * permiso puede llegar por PUBLIC o por herencia de un rol sin aparecer como concedido a moneo_app.
 */
import { describe, expect, it } from "vitest";
import { conexiones, enTransaccion, errorDe, PG } from "./_conexion";
import { crearMundo, type Mundo } from "./_mundo";

const { app, dueno } = conexiones();

describe("S-1 el arnés conecta como moneo_app", () => {
  it("la conexión de la app es moneo_app y la del dueño no", async () => {
    const r = await app.query<{ u: string }>("SELECT current_user AS u");
    expect(r.rows[0]?.u).toBe("moneo_app");
    const d = await dueno.query<{ u: string }>("SELECT current_user AS u");
    expect(d.rows[0]?.u).not.toBe("moneo_app");
  });

  it("moneo_app no es superusuario, no salta RLS, no crea roles ni bases, no hereda", async () => {
    const r = await dueno.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, rolreplication
         FROM pg_roles WHERE rolname = 'moneo_app'`,
    );
    expect(r.rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolinherit: false,
        rolreplication: false,
      },
    ]);
  });

  it("moneo_app no es miembro de ningún rol: no hereda permisos de nadie", async () => {
    const r = await dueno.query(
      `SELECT r.rolname AS rol FROM pg_auth_members am
         JOIN pg_roles r ON r.oid = am.roleid
         JOIN pg_roles m ON m.oid = am.member
        WHERE m.rolname = 'moneo_app'`,
    );
    expect(r.rows).toEqual([]);
  });

  // Hallazgo de F4-03b en Supabase local: ahí `postgres` NO es superusuario y crea roles con
  // CREATEROLE. Desde PG16, Postgres le concede al creador el rol nuevo con ADMIN OPTION (sin SET ni
  // INHERIT, por createrole_self_grant vacío) para que pueda administrarlo. En el CI no aparece porque
  // postgres es superusuario. Se tolera SOLO esa forma: con SET, ese rol podría actuar como moneo_app;
  // con INHERIT, tendría sus permisos.
  it("ningún rol puede actuar como moneo_app (miembros: solo el creador con ADMIN, sin SET ni INHERIT)", async () => {
    const r = await dueno.query(
      `SELECT m.rolname AS miembro, am.admin_option, am.inherit_option, am.set_option
         FROM pg_auth_members am
         JOIN pg_roles r ON r.oid = am.roleid
         JOIN pg_roles m ON m.oid = am.member
        WHERE r.rolname = 'moneo_app'
          AND NOT (am.admin_option AND NOT am.inherit_option AND NOT am.set_option)`,
    );
    expect(r.rows).toEqual([]);
  });

  it("moneo_app no es dueño de ningún objeto de public", async () => {
    const r = await dueno.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = 'moneo_app'`,
    );
    expect(r.rows).toEqual([]);
  });
});

/** Corre `prueba` como moneo_app con el mundo creado en la misma transacción. */
const conMundo = (prueba: (c: import("pg").PoolClient, m: Mundo) => Promise<void>) => () =>
  enTransaccion(app, async (c) => prueba(c, await crearMundo(c)));

describe("S-1 lo que moneo_app SÍ puede hacer", () => {
  it(
    "lee todas las tablas de negocio",
    conMundo(async (c) => {
      for (const t of [
        "profile",
        "space",
        "membership",
        "invitation",
        "account",
        "category",
        "subcategory",
        "allocation",
        "movement",
        "audit_event",
        "rate_limit_counter",
      ]) {
        await c.query(`SELECT * FROM "${t}" LIMIT 1`);
      }
    }),
  );

  it(
    "M-4 bloquea el espacio revalidando la membresía en la misma sentencia (FOR UPDATE OF s)",
    conMundo(async (c, m) => {
      const bloqueo = `SELECT s.id FROM space s
                         JOIN membership mb ON mb.space_id = s.id
                        WHERE s.id = $1 AND s.deleted_at IS NULL
                          AND mb.profile_id = $2 AND mb.ended_at IS NULL
                          FOR UPDATE OF s`;
      expect((await c.query(bloqueo, [m.espacioA, m.ana])).rowCount).toBe(1);
      // Beto no es miembro de A: la misma sentencia no devuelve fila (el servicio responde 404).
      expect((await c.query(bloqueo, [m.espacioA, m.beto])).rowCount).toBe(0);
    }),
  );

  it(
    "edita un movimiento con UPDATE … RETURNING * (como Prisma) y sube la versión",
    conMundo(async (c, m) => {
      const r = await c.query<{ amount_cents: string; version: number }>(
        `UPDATE movement SET amount_cents = 13000, note = 'feria', version = version + 1,
                updated_at = now(), updated_by_id = $2
          WHERE id = $1 AND space_id = $3 RETURNING *`,
        [m.gastoA, m.ana, m.espacioA],
      );
      expect(r.rows[0]).toMatchObject({ amount_cents: "13000", version: 2 });
    }),
  );

  it(
    "anula un movimiento (voided_at + voided_by_id)",
    conMundo(async (c, m) => {
      const r = await c.query(
        `UPDATE movement SET voided_at = now(), voided_by_id = $2 WHERE id = $1 RETURNING id`,
        [m.gastoA, m.ana],
      );
      expect(r.rowCount).toBe(1);
    }),
  );

  it(
    "edita la celda del plan solo en amount_cents y la autoría",
    conMundo(async (c, m) => {
      const r = await c.query(
        `UPDATE allocation SET amount_cents = 45000, updated_at = now(), updated_by_id = $2,
                version = version + 1 WHERE id = $1 RETURNING id`,
        [m.asignacionA, m.ana],
      );
      expect(r.rowCount).toBe(1);
    }),
  );

  it(
    "renombra, archiva y borra lógicamente una cuenta; acepta una invitación; cambia su nombre visible",
    conMundo(async (c, m) => {
      await c.query(`UPDATE account SET name = 'Nequi Ana', type = 'wallet' WHERE id = $1`, [
        m.nequiA,
      ]);
      await c.query(`UPDATE account SET archived_at = now() WHERE id = $1`, [m.cajaA]);
      await c.query(`UPDATE account SET archived_at = NULL, deleted_at = now() WHERE id = $1`, [
        m.cajaA,
      ]);
      await c.query(
        `UPDATE invitation SET accepted_at = now(), accepted_by_id = $2 WHERE id = $1`,
        [m.invitacionA, m.beto],
      );
      await c.query(`UPDATE profile SET display_name = 'Ana M.' WHERE id = $1`, [m.ana]);
    }),
  );

  it(
    "inserta auditoría (solo inserción, ADR-006)",
    conMundo(async (c, m) => {
      const r = await c.query(
        `INSERT INTO audit_event (space_id, actor_id, entity, entity_id, action, changes)
         VALUES ($1, $2, 'account', $3, 'update', '{"antes":{},"despues":{}}') RETURNING id`,
        [m.espacioA, m.ana, m.nequiA],
      );
      expect(r.rowCount).toBe(1);
    }),
  );

  it("usa rate_limit_counter: insertar, sumar y borrar ventanas vencidas", async () => {
    await enTransaccion(app, async (c) => {
      await c.query(
        `INSERT INTO rate_limit_counter (scope, key_hash, window_start, count)
         VALUES ('login', '\\x00', now() - interval '1 hour', 1)`,
      );
      await c.query(
        `UPDATE rate_limit_counter SET count = count + 1 WHERE scope = 'login' AND key_hash = '\\x00'`,
      );
      // Acotado a la fila propia: la base local puede tener ventanas vencidas de otras ejecuciones (dev, E2E).
      const r = await c.query(
        `DELETE FROM rate_limit_counter
         WHERE scope = 'login' AND key_hash = '\\x00' AND window_start < now() - interval '15 minutes'`,
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

type Prohibida = { nombre: string; sql: (m: Mundo) => string };

/** Sentencias que deben fallar con 42501 (permission denied / must be owner). */
const PROHIBIDAS: Prohibida[] = [
  // Mover filas a otro espacio: space_id no es actualizable en ninguna tabla (M-17).
  ...[
    "membership",
    "invitation",
    "account",
    "category",
    "subcategory",
    "allocation",
    "movement",
    "audit_event",
  ].map((t): Prohibida => ({
    nombre: `UPDATE ${t}.space_id`,
    sql: (m) => `UPDATE "${t}" SET space_id = '${m.espacioB}' WHERE space_id = '${m.espacioA}'`,
  })),
  // Inmutables de la cuenta (M-6) y autoría.
  ...[
    "opening_balance_cents = 0",
    "opened_on = '2026-01-02'",
    "holder_kind = 'shared'",
    "holder_profile_id = NULL",
    "created_by_id = created_by_id",
    "id = id",
  ].map((set): Prohibida => ({
    nombre: `UPDATE account SET ${set}`,
    sql: (m) => `UPDATE account SET ${set} WHERE id = '${m.nequiA}'`,
  })),
  // Identidad de la celda del plan.
  {
    nombre: "UPDATE allocation.period",
    sql: (m) => `UPDATE allocation SET period = '2026-01-01' WHERE id = '${m.asignacionA}'`,
  },
  {
    nombre: "UPDATE allocation.category_id",
    sql: (m) => `UPDATE allocation SET category_id = category_id WHERE id = '${m.asignacionA}'`,
  },
  // Movimiento: tipo, autoría e idempotencia.
  {
    nombre: "UPDATE movement.kind",
    sql: (m) => `UPDATE movement SET kind = 'income' WHERE id = '${m.gastoA}'`,
  },
  {
    nombre: "UPDATE movement.created_by_id",
    sql: (m) => `UPDATE movement SET created_by_id = '${m.beto}' WHERE id = '${m.gastoA}'`,
  },
  {
    nombre: "UPDATE movement.client_request_id",
    sql: (m) =>
      `UPDATE movement SET client_request_id = gen_random_uuid() WHERE id = '${m.gastoA}'`,
  },
  // Membresía y espacio.
  {
    nombre: "UPDATE membership.role",
    sql: (m) => `UPDATE membership SET role = 'collaborator' WHERE id = '${m.membresiaAna}'`,
  },
  {
    nombre: "UPDATE membership.ended_at (llega con UC-07, v1.1)",
    sql: (m) => `UPDATE membership SET ended_at = now() WHERE id = '${m.membresiaAna}'`,
  },
  {
    nombre: "UPDATE membership.profile_id",
    sql: (m) => `UPDATE membership SET profile_id = '${m.beto}' WHERE id = '${m.membresiaAna}'`,
  },
  {
    nombre: "UPDATE space.deleted_at (llega con UC-08, v1.1)",
    sql: (m) => `UPDATE space SET deleted_at = now() WHERE id = '${m.espacioA}'`,
  },
  {
    nombre: "UPDATE space.kind",
    sql: (m) => `UPDATE space SET kind = 'personal' WHERE id = '${m.espacioA}'`,
  },
  {
    nombre: "UPDATE space.created_by_id",
    sql: (m) => `UPDATE space SET created_by_id = '${m.beto}' WHERE id = '${m.espacioA}'`,
  },
  {
    nombre: "UPDATE invitation.token_hash",
    sql: (m) => `UPDATE invitation SET token_hash = token_hash WHERE id = '${m.invitacionA}'`,
  },
  {
    nombre: "UPDATE invitation.expires_at",
    sql: (m) =>
      `UPDATE invitation SET expires_at = now() + interval '1 year' WHERE id = '${m.invitacionA}'`,
  },
  {
    nombre: "UPDATE category.id",
    sql: (m) => `UPDATE category SET id = id WHERE id = '${m.mercadoA}'`,
  },
  {
    nombre: "UPDATE rate_limit_counter.window_start",
    sql: () => `UPDATE rate_limit_counter SET window_start = now()`,
  },
  // audit_event: solo inserción (ADR-006).
  {
    nombre: "UPDATE audit_event.changes",
    sql: (m) => `UPDATE audit_event SET changes = '{}' WHERE id = '${m.auditoriaA}'`,
  },
  {
    nombre: "DELETE audit_event",
    sql: (m) => `DELETE FROM audit_event WHERE id = '${m.auditoriaA}'`,
  },
  // Sin borrado físico de negocio (RN-23, M-12).
  ...[
    "profile",
    "space",
    "membership",
    "invitation",
    "account",
    "category",
    "subcategory",
    "allocation",
    "movement",
  ].map((t): Prohibida => ({ nombre: `DELETE ${t}`, sql: () => `DELETE FROM "${t}"` })),
  // Sin TRUNCATE en ninguna tabla (tampoco en rate_limit_counter).
  ...[
    "profile",
    "space",
    "membership",
    "invitation",
    "account",
    "category",
    "subcategory",
    "allocation",
    "movement",
    "audit_event",
    "rate_limit_counter",
  ].map((t): Prohibida => ({ nombre: `TRUNCATE ${t}`, sql: () => `TRUNCATE "${t}" CASCADE` })),
  // La tabla de Prisma: ni leerla ni escribirla.
  { nombre: "SELECT _prisma_migrations", sql: () => `SELECT * FROM "_prisma_migrations"` },
  {
    nombre: "INSERT _prisma_migrations",
    sql: () =>
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ('x', 'x', 'x')`,
  },
  // Sin DDL (inyección SQL con DDL, STRIDE E).
  { nombre: "CREATE TABLE en public", sql: () => `CREATE TABLE public.intrusa (id int)` },
  { nombre: "ALTER TABLE ADD COLUMN", sql: () => `ALTER TABLE account ADD COLUMN intrusa int` },
  {
    nombre: "DISABLE ROW LEVEL SECURITY",
    sql: () => `ALTER TABLE movement DISABLE ROW LEVEL SECURITY`,
  },
  { nombre: "DROP POLICY", sql: () => `DROP POLICY app_all ON movement` },
  { nombre: "DROP TABLE", sql: () => `DROP TABLE audit_event` },
  {
    nombre: "CREATE FUNCTION en public",
    sql: () => `CREATE FUNCTION public.intrusa() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
  },
  { nombre: "CREATE SCHEMA", sql: () => `CREATE SCHEMA intruso` },
  // Escalar privilegios.
  { nombre: "darse BYPASSRLS", sql: () => `ALTER ROLE moneo_app BYPASSRLS` },
  { nombre: "SET ROLE al dueño", sql: () => `SET ROLE postgres` },
];

describe("S-1 lo que moneo_app NO puede hacer (42501)", () => {
  for (const p of PROHIBIDAS) {
    it(
      p.nombre,
      conMundo(async (c, m) => {
        const e = await errorDe(c, p.sql(m));
        expect(e.code, e.message).toBe(PG.sinPermiso);
      }),
    );
  }
});
