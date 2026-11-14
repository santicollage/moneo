/**
 * S-1, S-2 · RLS y políticas (seguridad.md §6.2, RNF-SEG-10).
 *
 *   - Toda tabla de public tiene RLS activo, incluida `_prisma_migrations`. Cierra el hueco de F4-03a:
 *     el ENABLE de esa tabla va en un bloque DO con to_regclass y podría omitirse en silencio.
 *   - Toda tabla de negocio tiene su política `app_all` para moneo_app; `_prisma_migrations`, ninguna.
 *   - Toda política de public apunta exactamente a {moneo_app}: ninguna para anon, authenticated ni
 *     PUBLIC. Esta forma corre en todas partes, también en el PG17 del CI, donde esos roles no existen.
 *   - Sonda de §6.2: sin política, moneo_app ve 0 filas y no puede insertar (por eso existe app_all).
 *   - Donde existen los roles de Supabase (Supabase local, staging): anon, authenticated y service_role
 *     no tienen NINGÚN permiso sobre las tablas de public (12 comprobaciones de F3-03, aquí todas).
 */
import { describe, expect, it } from "vitest";
import { conexiones, enTransaccion, errorDe, PG } from "./_conexion";

const { app, dueno } = conexiones();

const TABLAS_DE_NEGOCIO = [
  "account",
  "allocation",
  "audit_event",
  "category",
  "invitation",
  "membership",
  "movement",
  "profile",
  "rate_limit_counter",
  "space",
  "subcategory",
];

describe("S-2 RLS activo en toda tabla de public", () => {
  it("ninguna tabla de public tiene RLS apagado (incluida _prisma_migrations)", async () => {
    const r = await dueno.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
        ORDER BY c.relname COLLATE "C"`,
    );
    expect(r.rows.map((f) => f.relname)).toEqual([]);
  });

  it("_prisma_migrations existe (si no, la prueba anterior no la estaría mirando)", async () => {
    const r = await dueno.query<{ existe: boolean }>(
      `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS existe`,
    );
    expect(r.rows[0]?.existe).toBe(true);
  });

  it("las tablas de public son exactamente las 11 de negocio más _prisma_migrations", async () => {
    const r = await dueno.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname COLLATE "C"`,
    );
    expect(r.rows.map((f) => f.relname)).toEqual(["_prisma_migrations", ...TABLAS_DE_NEGOCIO]);
  });
});

describe("S-1 políticas: una por tabla de negocio, solo para moneo_app", () => {
  it("cada tabla de negocio tiene app_all FOR ALL TO moneo_app USING (true) WITH CHECK (true)", async () => {
    const r = await dueno.query(
      `SELECT tablename, policyname, cmd, roles::text[] AS roles, qual, with_check
         FROM pg_policies WHERE schemaname = 'public'
        ORDER BY tablename COLLATE "C", policyname COLLATE "C"`,
    );
    expect(r.rows).toEqual(
      TABLAS_DE_NEGOCIO.map((t) => ({
        tablename: t,
        policyname: "app_all",
        cmd: "ALL",
        roles: ["moneo_app"],
        qual: "true",
        with_check: "true",
      })),
    );
  });

  it("ninguna política de public apunta a otro rol que moneo_app (ni anon, ni authenticated, ni PUBLIC)", async () => {
    const r = await dueno.query(
      `SELECT tablename, policyname, roles::text[] AS roles FROM pg_policies
        WHERE schemaname = 'public' AND roles::text[] <> ARRAY['moneo_app']`,
    );
    expect(r.rows).toEqual([]);
  });

  it("todas las políticas son permisivas (una restrictiva cambiaría la semántica sin avisar)", async () => {
    const r = await dueno.query(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND permissive <> 'PERMISSIVE'`,
    );
    expect(r.rows).toEqual([]);
  });
});

describe("S-1 sonda de §6.2: RLS sin política deja a moneo_app sin datos", () => {
  // Esquema propio, fuera de public, para no ensuciar el manifiesto ni las otras pruebas.
  // La tabla debe quedar confirmada (COMMIT) para que la conexión de la app la vea; se borra al final.
  const esquema = `zz_sonda_rls_${process.pid}`;

  it("con GRANT y sin política: 0 filas al leer y el INSERT viola RLS", async () => {
    await dueno.query(`CREATE SCHEMA ${esquema}`);
    try {
      await dueno.query(`CREATE TABLE ${esquema}.t (id int)`);
      await dueno.query(`INSERT INTO ${esquema}.t VALUES (1)`);
      await dueno.query(`ALTER TABLE ${esquema}.t ENABLE ROW LEVEL SECURITY`);
      await dueno.query(`GRANT USAGE ON SCHEMA ${esquema} TO moneo_app`);
      await dueno.query(`GRANT SELECT, INSERT ON ${esquema}.t TO moneo_app`);

      await enTransaccion(app, async (c) => {
        const r = await c.query(`SELECT * FROM ${esquema}.t`);
        expect(r.rowCount).toBe(0);
        const e = await errorDe(c, `INSERT INTO ${esquema}.t VALUES (2)`);
        expect(e.code).toBe(PG.sinPermiso);
        expect(e.message).toMatch(/row-level security/);
      });
    } finally {
      await dueno.query(`DROP SCHEMA ${esquema} CASCADE`);
    }
  });
});

const ROLES_SUPABASE = ["anon", "authenticated", "service_role"];
const PRIVILEGIOS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

const filas = await dueno.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ANY($1)",
  [ROLES_SUPABASE],
);
const hayRolesDeSupabase = filas.rows[0]?.n === ROLES_SUPABASE.length;

describe("S-2 roles de la Data API sin ningún permiso (solo donde existen)", () => {
  it("si EXPECT_SUPABASE_ROLES=1 (Supabase local), los tres roles existen: la sección de abajo no se omite en silencio", () => {
    if (process.env.EXPECT_SUPABASE_ROLES === "1") expect(hayRolesDeSupabase).toBe(true);
  });

  // Se omite en el PG17 del CI: ahí esos roles no existen y la migración del rol los salta (S-2).
  // Corre en Supabase local (con EXPECT_SUPABASE_ROLES=1) y se repite contra staging en F5-07.
  // has_table_privilege mide el permiso EFECTIVO (directo, por PUBLIC o heredado). service_role tiene
  // BYPASSRLS en Supabase: para él la única barrera es esta (y el interruptor de la Data API, F4-03c).
  it.skipIf(!hayRolesDeSupabase)(
    "anon, authenticated y service_role no tienen permisos de tabla ni de columna en public",
    async () => {
      const r = await dueno.query(
        `SELECT rol, c.relname, priv
           FROM unnest($1::text[]) AS rol
           CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN unnest($2::text[]) AS priv
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND (has_table_privilege(rol, c.oid, priv)
                 OR (priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                     AND has_any_column_privilege(rol, c.oid, priv)))`,
        [ROLES_SUPABASE, PRIVILEGIOS],
      );
      expect(r.rows).toEqual([]);
    },
  );
});
