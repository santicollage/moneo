/**
 * S-7 · Registro cerrado por la lista permitida (F4-05-D1, F4-05b-D1).
 *
 * La función del hook se prueba aquí, en Postgres, con el mismo `event` que manda Supabase Auth
 * (documentación del hook *Before User Created*). Que Auth la LLAME se prueba contra Supabase local
 * (`pnpm test:auth-local`) y contra staging (`scripts/supabase-real/probar-registro-cerrado.ps1`).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { conexiones, enTransaccion, errorDe, PG } from "./_conexion";

const { app, dueno } = conexiones();
const RECHAZO = { error: { http_code: 403, message: "Signup not allowed" } };
const evento = (email: unknown) =>
  JSON.stringify({
    metadata: {
      uuid: randomUUID(),
      time: new Date().toISOString(),
      name: "before-user-created",
      ip_address: "127.0.0.1",
    },
    user: { id: randomUUID(), aud: "authenticated", role: "", email },
  });

describe("S-7 signup_gate.before_user_created", () => {
  it("permite un correo de la lista y rechaza los demás", async () => {
    await enTransaccion(dueno, async (c) => {
      const correo = `permitido-${randomUUID()}@moneo.test`;
      await c.query(`INSERT INTO signup_gate.allowed_email (email) VALUES ($1)`, [correo]);
      const llamar = async (email: unknown) =>
        (
          await c.query<{ r: unknown }>(`SELECT signup_gate.before_user_created($1::jsonb) AS r`, [
            evento(email),
          ])
        ).rows[0]!.r;
      expect(await llamar(correo)).toEqual({});
      // Supabase guarda el correo en minúsculas, pero la función no depende de eso.
      expect(await llamar(`  ${correo.toUpperCase()} `)).toEqual({});
      expect(await llamar(`otro-${randomUUID()}@moneo.test`)).toEqual(RECHAZO);
      expect(await llamar(null)).toEqual(RECHAZO); // teléfono u OAuth sin correo
      expect(await llamar("")).toEqual(RECHAZO);
    });
  });

  it("con la lista vacía nadie se registra (falla cerrado)", async () => {
    await enTransaccion(dueno, async (c) => {
      await c.query(`DELETE FROM signup_gate.allowed_email`);
      const r = await c.query<{ r: unknown }>(
        `SELECT signup_gate.before_user_created($1::jsonb) AS r`,
        [evento("ana@moneo.test")],
      );
      expect(r.rows[0]!.r).toEqual(RECHAZO);
    });
  });

  it("la tabla solo acepta correos normalizados (igual que claveCorreo)", async () => {
    await enTransaccion(dueno, async (c) => {
      for (const malo of ["Ana@moneo.test", " ana@moneo.test", "sin-arroba", "a b@moneo.test"]) {
        expect(
          (await errorDe(c, `INSERT INTO signup_gate.allowed_email (email) VALUES ($1)`, [malo]))
            .code,
        ).toBe(PG.violaCheck);
      }
    });
  });

  it("la función es SECURITY DEFINER con search_path vacío y PUBLIC no la ejecuta", async () => {
    const r = await dueno.query<{ prosecdef: boolean; proconfig: string[]; publico: boolean }>(
      `SELECT p.prosecdef, p.proconfig,
              has_function_privilege('public', p.oid, 'EXECUTE') AS publico
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'signup_gate' AND p.proname = 'before_user_created'`,
    );
    expect(r.rows).toEqual([{ prosecdef: true, proconfig: ['search_path=""'], publico: false }]);
  });

  it("moneo_app no llega al esquema: ni la tabla ni la función", async () => {
    await enTransaccion(app, async (c) => {
      expect((await errorDe(c, `SELECT * FROM signup_gate.allowed_email`)).code).toBe(
        PG.sinPermiso,
      );
      expect(
        (await errorDe(c, `INSERT INTO signup_gate.allowed_email VALUES ('x@moneo.test')`)).code,
      ).toBe(PG.sinPermiso);
      expect((await errorDe(c, `SELECT signup_gate.before_user_created('{}'::jsonb)`)).code).toBe(
        PG.sinPermiso,
      );
    });
  });

  it("donde existe supabase_auth_admin (Supabase local), solo puede EJECUTAR, no leer la lista", async () => {
    const roles = await dueno.query(`SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin'`);
    if (roles.rowCount === 0) {
      expect(
        process.env.EXPECT_SUPABASE_ROLES,
        "EXPECT_SUPABASE_ROLES=1 pero falta supabase_auth_admin",
      ).not.toBe("1");
      return;
    }
    const r = await dueno.query<{ ejecuta: boolean; lee: boolean }>(
      `SELECT has_function_privilege('supabase_auth_admin', 'signup_gate.before_user_created(jsonb)', 'EXECUTE') AS ejecuta,
              has_table_privilege('supabase_auth_admin', 'signup_gate.allowed_email', 'SELECT') AS lee`,
    );
    expect(r.rows[0]).toEqual({ ejecuta: true, lee: false });
    for (const rol of ["anon", "authenticated", "service_role"]) {
      const x = await dueno.query<{ usa: boolean }>(
        `SELECT has_schema_privilege($1, 'signup_gate', 'USAGE') AS usa`,
        [rol],
      );
      expect(x.rows[0]?.usa, rol).toBe(false);
    }
  });
});
