/**
 * Restricciones de la base que `prisma migrate diff` NO ve (parte B de la migración inicial y la
 * migración de A-1), más las FK compuestas y los índices parciales (11-modelo-de-datos.md,
 * 11a-revision-critica-f3-02.md, 12-diseno-api.md §3.2).
 *
 * Todo corre COMO moneo_app dentro de BEGIN … ROLLBACK: así se prueba además que la app choca con el
 * CHECK (23514) y no con un permiso (42501). Solo M-17 usa al dueño, para mostrar que ni él puede
 * mover datos entre espacios.
 *
 * Una prueba de cobertura exige que cada CHECK de public tenga aquí un caso que lo viole: un CHECK
 * nuevo sin caso, o uno que desaparezca de una migración, pone el CI en rojo.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_CENTS } from "@/contracts/shared/money";
import { conexiones, enTransaccion, errorDe, PG } from "./_conexion";
import { crearMundo, type Mundo } from "./_mundo";

const { app, dueno } = conexiones();

const conMundo = (prueba: (c: pg.PoolClient, m: Mundo) => Promise<void>) => () =>
  enTransaccion(app, async (c) => prueba(c, await crearMundo(c)));

const MAX = MAX_AMOUNT_CENTS.toString();
const MAX_MAS_1 = (MAX_AMOUNT_CENTS + 1n).toString();

// Plantillas de inserción válidas: cada caso cambia UNA cosa para romper UN CHECK.
const cuenta = (m: Mundo, o: Partial<Record<string, string | null>> = {}) => {
  const v = {
    name: "'Otra'",
    holder_kind: "'shared'",
    holder_profile_id: "NULL",
    opening_balance_cents: "0",
    archived_at: "NULL",
    deleted_at: "NULL",
    ...o,
  };
  return `INSERT INTO account (space_id, name, type, holder_kind, holder_profile_id, opened_on,
            opening_balance_cents, created_by_id, updated_by_id, archived_at, deleted_at)
          VALUES ('${m.espacioA}', ${v.name}, 'cash', ${v.holder_kind}, ${v.holder_profile_id},
            '2026-01-01', ${v.opening_balance_cents}, '${m.ana}', '${m.ana}', ${v.archived_at}, ${v.deleted_at})`;
};

const movimiento = (m: Mundo, o: Partial<Record<string, string>> = {}) => {
  const v = {
    kind: "'expense'",
    direction: "'outflow'",
    amount_cents: "1000",
    account_id: `'${m.nequiA}'`,
    counter_account_id: "NULL",
    category_id: `'${m.mercadoA}'`,
    subcategory_id: "NULL",
    occurred_on: "'2026-02-12'",
    voided_at: "NULL",
    voided_by_id: "NULL",
    ...o,
  };
  return `INSERT INTO movement (space_id, kind, direction, amount_cents, account_id, counter_account_id,
            category_id, subcategory_id, occurred_on, created_by_id, updated_by_id, voided_at, voided_by_id)
          VALUES ('${m.espacioA}', ${v.kind}, ${v.direction}, ${v.amount_cents}, ${v.account_id},
            ${v.counter_account_id}, ${v.category_id}, ${v.subcategory_id}, ${v.occurred_on},
            '${m.ana}', '${m.ana}', ${v.voided_at}, ${v.voided_by_id})`;
};

const asignacion = (m: Mundo, o: Partial<Record<string, string>> = {}) => {
  const v = { category_id: `'${m.mercadoA}'`, period: "'2026-03-01'", amount_cents: "1000", ...o };
  return `INSERT INTO allocation (space_id, category_id, period, amount_cents, created_by_id, updated_by_id)
          VALUES ('${m.espacioA}', ${v.category_id}, ${v.period}, ${v.amount_cents}, '${m.ana}', '${m.ana}')`;
};

const invitacion = (m: Mundo, o: Partial<Record<string, string>> = {}) => {
  const v = {
    token_hash: "decode(repeat('ab', 32), 'hex')",
    created_at: "now()",
    expires_at: "now() + interval '72 hours'",
    accepted_at: "NULL",
    accepted_by_id: "NULL",
    revoked_at: "now()", // revocada: no choca con "una invitación abierta por espacio"
    ...o,
  };
  return `INSERT INTO invitation (space_id, token_hash, created_by_id, created_at, expires_at,
            accepted_at, accepted_by_id, revoked_at)
          VALUES ('${m.espacioA}', ${v.token_hash}, '${m.ana}', ${v.created_at}, ${v.expires_at},
            ${v.accepted_at}, ${v.accepted_by_id}, ${v.revoked_at})`;
};

type Caso = { restriccion: string; nombre: string; sql: (m: Mundo) => string };

/** Un caso por CHECK de public: la sentencia viola exactamente esa restricción. */
const CHECKS: Caso[] = [
  // Nombres no vacíos
  {
    restriccion: "space_name_not_blank",
    nombre: "espacio con nombre en blanco",
    sql: (m) =>
      `INSERT INTO space (kind, name, created_by_id) VALUES ('shared', '   ', '${m.ana}')`,
  },
  {
    restriccion: "account_name_not_blank",
    nombre: "cuenta con nombre en blanco",
    sql: (m) => cuenta(m, { name: "'  '" }),
  },
  {
    restriccion: "category_name_not_blank",
    nombre: "categoría con nombre en blanco",
    sql: (m) =>
      `INSERT INTO category (space_id, "group", name, name_key, created_by_id, updated_by_id) VALUES ('${m.espacioA}', 'wants', '  ', '', '${m.ana}', '${m.ana}')`,
  },
  {
    restriccion: "subcategory_name_not_blank",
    nombre: "subcategoría con nombre en blanco",
    sql: (m) =>
      `INSERT INTO subcategory (space_id, category_id, name, name_key, created_by_id, updated_by_id) VALUES ('${m.espacioA}', '${m.mercadoA}', ' ', '', '${m.ana}', '${m.ana}')`,
  },
  {
    restriccion: "profile_display_name_not_blank",
    nombre: "perfil con nombre visible en blanco",
    sql: () => `INSERT INTO profile (id, display_name) VALUES (gen_random_uuid(), '  ')`,
  },
  // Titular (D-19) y MATCH SIMPLE: sin el CHECK, holder_profile_id NULL saltaría la FK compuesta
  {
    restriccion: "account_holder_consistent",
    nombre: "titular 'member' sin persona",
    sql: (m) => cuenta(m, { holder_kind: "'member'" }),
  },
  {
    restriccion: "account_holder_consistent",
    nombre: "titular 'shared' con persona",
    sql: (m) => cuenta(m, { holder_profile_id: `'${m.ana}'` }),
  },
  {
    restriccion: "account_not_archived_and_deleted",
    nombre: "cuenta archivada y borrada a la vez",
    sql: (m) => cuenta(m, { archived_at: "now()", deleted_at: "now()" }),
  },
  // Invitación
  {
    restriccion: "invitation_expiry_after_creation",
    nombre: "vence al mismo tiempo que se crea",
    sql: (m) =>
      invitacion(m, { created_at: "'2026-02-01 10:00'", expires_at: "'2026-02-01 10:00'" }),
  },
  {
    restriccion: "invitation_accepted_pair",
    nombre: "aceptada sin quién la aceptó",
    sql: (m) => invitacion(m, { accepted_at: "now()" }),
  },
  {
    restriccion: "invitation_hash_len",
    nombre: "hash de 31 bytes",
    sql: (m) => invitacion(m, { token_hash: "decode(repeat('ab', 31), 'hex')" }),
  },
  // Membresía
  {
    restriccion: "membership_end_after_start",
    nombre: "termina antes de empezar",
    sql: (m) =>
      `INSERT INTO membership (space_id, profile_id, role, created_at, ended_at) VALUES ('${m.espacioB}', '${m.ana}', 'collaborator', '2026-02-02', '2026-02-01')`,
  },
  // name_key normalizado (RN-22)
  {
    restriccion: "category_name_key_normalized",
    nombre: "name_key sin normalizar en categoría",
    sql: (m) =>
      `INSERT INTO category (space_id, "group", name, name_key, created_by_id, updated_by_id) VALUES ('${m.espacioA}', 'wants', 'Ocio', 'Ocio', '${m.ana}', '${m.ana}')`,
  },
  {
    restriccion: "subcategory_name_key_normalized",
    nombre: "name_key sin normalizar en subcategoría",
    sql: (m) =>
      `INSERT INTO subcategory (space_id, category_id, name, name_key, created_by_id, updated_by_id) VALUES ('${m.espacioA}', '${m.mercadoA}', 'Carnes', ' carnes', '${m.ana}', '${m.ana}')`,
  },
  // Plan (RN-15)
  {
    restriccion: "allocation_period_first_day",
    nombre: "periodo que no es día 1",
    sql: (m) => asignacion(m, { period: "'2026-03-15'" }),
  },
  // Movimientos (RN-08 a RN-14, CT-06)
  {
    restriccion: "movement_amount_positive",
    nombre: "monto 0",
    sql: (m) => movimiento(m, { amount_cents: "0" }),
  },
  {
    restriccion: "movement_amount_positive",
    nombre: "monto negativo",
    sql: (m) => movimiento(m, { amount_cents: "-1" }),
  },
  {
    restriccion: "movement_direction_by_kind",
    nombre: "gasto que entra",
    sql: (m) => movimiento(m, { direction: "'inflow'" }),
  },
  {
    restriccion: "movement_direction_by_kind",
    nombre: "ajuste sin sentido",
    sql: (m) =>
      movimiento(m, { kind: "'balance_adjustment'", direction: "NULL", category_id: "NULL" }),
  },
  {
    restriccion: "movement_transfer_has_counter",
    nombre: "transferencia sin cuenta destino",
    sql: (m) => movimiento(m, { kind: "'transfer'", direction: "NULL", category_id: "NULL" }),
  },
  {
    restriccion: "movement_transfer_has_counter",
    nombre: "ingreso con cuenta destino",
    sql: (m) =>
      movimiento(m, {
        kind: "'income'",
        direction: "'inflow'",
        category_id: "NULL",
        counter_account_id: `'${m.cajaA}'`,
      }),
  },
  {
    restriccion: "movement_transfer_distinct_accounts",
    nombre: "transferencia a la misma cuenta",
    sql: (m) =>
      movimiento(m, {
        kind: "'transfer'",
        direction: "NULL",
        category_id: "NULL",
        counter_account_id: `'${m.nequiA}'`,
      }),
  },
  {
    restriccion: "movement_category_by_kind",
    nombre: "gasto sin categoría",
    sql: (m) => movimiento(m, { category_id: "NULL" }),
  },
  {
    restriccion: "movement_category_by_kind",
    nombre: "ingreso con categoría",
    sql: (m) => movimiento(m, { kind: "'income'", direction: "'inflow'" }),
  },
  // MATCH SIMPLE: con category_id NULL, la FK (subcategory_id, category_id) no se verifica; este CHECK la cubre
  {
    restriccion: "movement_subcategory_needs_category",
    nombre: "subcategoría sin categoría (trampa de MATCH SIMPLE)",
    sql: (m) =>
      movimiento(m, {
        kind: "'income'",
        direction: "'inflow'",
        category_id: "NULL",
        subcategory_id: `'${m.frutasB}'`,
      }),
  },
  {
    restriccion: "movement_voided_pair",
    nombre: "anulado sin quién lo anuló",
    sql: (m) => movimiento(m, { voided_at: "now()" }),
  },
  {
    restriccion: "rate_limit_count_non_negative",
    nombre: "contador negativo",
    sql: () =>
      `INSERT INTO rate_limit_counter (scope, key_hash, window_start, count) VALUES ('login', '\\x01', now(), -1)`,
  },
  // M-19: sin fechas ni periodos futuros en hora de Bogotá ("mañana" lo calcula la base)
  {
    restriccion: "movement_not_future",
    nombre: "M-19 movimiento con fecha de mañana en Bogotá",
    sql: (m) => movimiento(m, { occurred_on: "((now() AT TIME ZONE 'America/Bogota')::date + 1)" }),
  },
  {
    restriccion: "allocation_not_future",
    nombre: "M-19 asignación en el mes siguiente en Bogotá",
    sql: (m) =>
      asignacion(m, {
        period:
          "(date_trunc('month', now() AT TIME ZONE 'America/Bogota') + interval '1 month')::date",
      }),
  },
  // A-1: monto máximo (RN-25), el mismo número que MAX_AMOUNT_CENTS
  {
    restriccion: "movement_amount_max",
    nombre: "A-1 movimiento de MAX + 1",
    sql: (m) => movimiento(m, { amount_cents: MAX_MAS_1 }),
  },
  {
    restriccion: "account_opening_balance_bounded",
    nombre: "A-1 saldo inicial de MAX + 1",
    sql: (m) => cuenta(m, { opening_balance_cents: MAX_MAS_1 }),
  },
  {
    restriccion: "account_opening_balance_bounded",
    nombre: "A-1 saldo inicial de −(MAX + 1)",
    sql: (m) => cuenta(m, { opening_balance_cents: `-${MAX_MAS_1}` }),
  },
  {
    restriccion: "allocation_amount_bounded",
    nombre: "A-1 asignación de MAX + 1",
    sql: (m) => asignacion(m, { amount_cents: MAX_MAS_1 }),
  },
  {
    restriccion: "allocation_amount_bounded",
    nombre: "A-1 asignación de −(MAX + 1)",
    sql: (m) => asignacion(m, { amount_cents: `-${MAX_MAS_1}` }),
  },
];

describe("CHECK de la parte B y de A-1 (invisibles para migrate diff)", () => {
  for (const caso of CHECKS) {
    it(
      `${caso.restriccion}: ${caso.nombre}`,
      conMundo(async (c, m) => {
        const e = await errorDe(c, caso.sql(m));
        expect({ code: e.code, constraint: e.constraint }, e.message).toEqual({
          code: PG.violaCheck,
          constraint: caso.restriccion,
        });
      }),
    );
  }

  it("cobertura: cada CHECK de public tiene al menos un caso aquí, y cada caso apunta a un CHECK que existe", async () => {
    const r = await dueno.query<{ conname: string }>(
      `SELECT con.conname FROM pg_constraint con
         JOIN pg_namespace n ON n.oid = con.connamespace
        WHERE n.nspname = 'public' AND con.contype = 'c'
        ORDER BY con.conname COLLATE "C"`,
    );
    const enLaBase = r.rows.map((f) => f.conname);
    const conCaso = [...new Set(CHECKS.map((c) => c.restriccion))].sort();
    expect(conCaso).toEqual(enLaBase);
  });

  it(
    "las filas válidas del borde pasan: hoy, mes actual, MAX y −MAX",
    conMundo(async (c, m) => {
      await c.query(movimiento(m, { occurred_on: "(now() AT TIME ZONE 'America/Bogota')::date" }));
      await c.query(
        asignacion(m, { period: "date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date" }),
      );
      await c.query(movimiento(m, { amount_cents: MAX }));
      await c.query(cuenta(m, { opening_balance_cents: MAX }));
      await c.query(cuenta(m, { name: "'Tarjeta'", opening_balance_cents: `-${MAX}` }));
      await c.query(asignacion(m, { period: "'2026-04-01'", amount_cents: MAX }));
      await c.query(asignacion(m, { period: "'2026-05-01'", amount_cents: `-${MAX}` }));
    }),
  );
});

describe("A-1 el CHECK de la base y MAX_AMOUNT_CENTS son el mismo número", () => {
  it("las tres definiciones en pg_constraint usan exactamente MAX_AMOUNT_CENTS", async () => {
    const r = await dueno.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('movement_amount_max', 'account_opening_balance_bounded', 'allocation_amount_bounded')
        ORDER BY conname COLLATE "C"`,
    );
    expect(r.rows.map((f) => f.conname)).toEqual([
      "account_opening_balance_bounded",
      "allocation_amount_bounded",
      "movement_amount_max",
    ]);
    for (const f of r.rows) {
      // Ej.: CHECK (((amount_cents >= '-99999999999'::bigint) AND (amount_cents <= '99999999999'::bigint)))
      const numeros = [...f.def.matchAll(/-?\d{6,}/g)].map((x) => BigInt(x[0]));
      expect(numeros.length, f.def).toBeGreaterThan(0);
      for (const n of numeros)
        expect(n < 0n ? -n : n, `${f.conname}: ${f.def}`).toBe(MAX_AMOUNT_CENTS);
    }
  });
});

describe("CT-02 FK compuestas: nada de otro espacio entra por una referencia", () => {
  const CRUZADAS: { restriccion: string; nombre: string; sql: (m: Mundo) => string }[] = [
    {
      restriccion: "movement_category_fkey",
      nombre: "gasto en A con categoría de B",
      sql: (m) => movimiento(m, { category_id: `'${m.mercadoB}'` }),
    },
    {
      restriccion: "movement_account_fkey",
      nombre: "gasto en A desde una cuenta de B",
      sql: (m) => movimiento(m, { account_id: `'${m.cuentaB}'` }),
    },
    {
      restriccion: "movement_counter_account_fkey",
      nombre: "transferencia de A hacia una cuenta de B",
      sql: (m) =>
        movimiento(m, {
          kind: "'transfer'",
          direction: "NULL",
          category_id: "NULL",
          counter_account_id: `'${m.cuentaB}'`,
        }),
    },
    {
      restriccion: "movement_subcategory_fkey",
      nombre: "gasto en Mercado de A con subcategoría de B",
      sql: (m) => movimiento(m, { subcategory_id: `'${m.frutasB}'` }),
    },
    {
      restriccion: "allocation_category_id_space_id_fkey",
      nombre: "asignación en A a una categoría de B",
      sql: (m) => asignacion(m, { category_id: `'${m.mercadoB}'` }),
    },
    {
      restriccion: "subcategory_category_id_space_id_fkey",
      nombre: "subcategoría en A bajo una categoría de B",
      sql: (m) =>
        `INSERT INTO subcategory (space_id, category_id, name, name_key, created_by_id, updated_by_id) VALUES ('${m.espacioA}', '${m.mercadoB}', 'X', 'x', '${m.ana}', '${m.ana}')`,
    },
    {
      restriccion: "account_holder_membership_fkey",
      nombre: "cuenta en A con titular que no es miembro de A",
      sql: (m) => cuenta(m, { holder_kind: "'member'", holder_profile_id: `'${m.beto}'` }),
    },
  ];
  for (const caso of CRUZADAS) {
    it(
      `${caso.restriccion}: ${caso.nombre}`,
      conMundo(async (c, m) => {
        const e = await errorDe(c, caso.sql(m));
        expect({ code: e.code, constraint: e.constraint }, e.message).toEqual({
          code: PG.violaFk,
          constraint: caso.restriccion,
        });
      }),
    );
  }
});

describe("M-17 ON UPDATE RESTRICT: ni el dueño mueve datos entre espacios", () => {
  it("todas las FK de public son ON UPDATE RESTRICT y ON DELETE RESTRICT", async () => {
    const r = await dueno.query(
      `SELECT con.conname, con.confupdtype, con.confdeltype FROM pg_constraint con
         JOIN pg_namespace n ON n.oid = con.connamespace
        WHERE n.nspname = 'public' AND con.contype = 'f'
          AND (con.confupdtype <> 'r' OR con.confdeltype <> 'r')`,
    );
    expect(r.rows).toEqual([]);
    const total = await dueno.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
        WHERE n.nspname = 'public' AND con.contype = 'f'`,
    );
    expect(total.rows[0]?.n).toBe(31); // 31 de 31 (11a, H1)
  });

  it("H1: mover una cuenta con movimientos a otro espacio falla también como dueño", async () => {
    await enTransaccion(dueno, async (c) => {
      const m = await crearMundo(c);
      const e = await errorDe(c, `UPDATE account SET space_id = $1 WHERE id = $2`, [
        m.espacioB,
        m.nequiA,
      ]);
      expect(e.code, e.message).toBe(PG.violaFk);
      const e2 = await errorDe(c, `UPDATE space SET id = gen_random_uuid() WHERE id = $1`, [
        m.espacioA,
      ]);
      expect(e2.code, e2.message).toBe(PG.violaFk);
    });
  });
});

describe("M-18 e índices parciales (partialIndexes, F4-03a)", () => {
  it("los 3 índices parciales existen con su WHERE", async () => {
    const r = await dueno.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
          AND indexname IN ('invitation_one_open_per_space', 'membership_one_active_per_profile', 'membership_one_owner_per_space')
        ORDER BY indexname COLLATE "C"`,
    );
    expect(r.rows.map((f) => f.indexname)).toEqual([
      "invitation_one_open_per_space",
      "membership_one_active_per_profile",
      "membership_one_owner_per_space",
    ]);
    for (const f of r.rows) {
      expect(f.indexdef, f.indexname).toMatch(/^CREATE UNIQUE INDEX .* WHERE /);
    }
  });

  it(
    "invitation_one_open_per_space: segunda invitación abierta en el mismo espacio",
    conMundo(async (c, m) => {
      const e = await errorDe(c, invitacion(m, { revoked_at: "NULL" }));
      expect({ code: e.code, constraint: e.constraint }).toEqual({
        code: PG.violaUnico,
        constraint: "invitation_one_open_per_space",
      });
    }),
  );

  it(
    "membership_one_active_per_profile (S6, M-18): Ana no puede tener una segunda membresía activa",
    conMundo(async (c, m) => {
      const e = await errorDe(
        c,
        `INSERT INTO membership (space_id, profile_id, role) VALUES ($1, $2, 'collaborator')`,
        [m.espacioB, m.ana],
      );
      expect({ code: e.code, constraint: e.constraint }).toEqual({
        code: PG.violaUnico,
        constraint: "membership_one_active_per_profile",
      });
    }),
  );

  it(
    "membership_one_owner_per_space: un segundo propietario activo en el mismo espacio",
    conMundo(async (c, m) => {
      const carla = (
        await c.query<{ id: string }>(
          `INSERT INTO profile (id, display_name) VALUES (gen_random_uuid(), 'Carla') RETURNING id`,
        )
      ).rows[0]!.id;
      const e = await errorDe(
        c,
        `INSERT INTO membership (space_id, profile_id, role) VALUES ($1, $2, 'owner')`,
        [m.espacioA, carla],
      );
      expect({ code: e.code, constraint: e.constraint }).toEqual({
        code: PG.violaUnico,
        constraint: "membership_one_owner_per_space",
      });
    }),
  );

  it(
    "RN-22: nombre de categoría repetido en el mismo espacio (por name_key)",
    conMundo(async (c, m) => {
      const e = await errorDe(
        c,
        `INSERT INTO category (space_id, "group", name, name_key, created_by_id, updated_by_id)
         VALUES ($1, 'wants', 'mercado ', 'mercado', $2, $2)`,
        [m.espacioA, m.ana],
      );
      expect({ code: e.code, constraint: e.constraint }).toEqual({
        code: PG.violaUnico,
        constraint: "category_space_id_name_key_key",
      });
    }),
  );
});
