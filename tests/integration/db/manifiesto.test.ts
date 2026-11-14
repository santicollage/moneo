/**
 * S-3 · Los permisos de `moneo_app` son un manifiesto probado (seguridad.md §0, §6.3).
 *
 * Compara `prisma/permisos-moneo_app.json` con lo que dicen los catálogos de Postgres (ACL de cada
 * tabla y de cada columna). Falla si:
 *   - una tabla, vista o secuencia de public no tiene entrada en el manifiesto (tabla nueva sin revisar);
 *   - el manifiesto lista una tabla que ya no existe;
 *   - moneo_app tiene un permiso de tabla o de columna de más o de menos;
 *   - PUBLIC tiene algún permiso sobre una tabla de public (lo heredaría cualquier rol);
 *   - moneo_app puede crear objetos en public.
 * Se leen las ACL con aclexplode y no con information_schema.column_privileges, porque esa vista
 * repite en cada columna los permisos de tabla y no deja ver qué se concedió por columna.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conexiones } from "./_conexion";

type EntradaTabla = { tabla: string[]; columnas: Record<string, string[]> };
type Manifiesto = { rol: string; esquema: string; tablas: Record<string, EntradaTabla> };

const manifiesto = JSON.parse(
  readFileSync(join(process.cwd(), "prisma", "permisos-moneo_app.json"), "utf8"),
) as Manifiesto;

const { dueno } = conexiones();

/** Forma normalizada y ordenada, para que el diff de una falla sea legible. */
function normalizar(t: Record<string, EntradaTabla>): Record<string, EntradaTabla> {
  const salida: Record<string, EntradaTabla> = {};
  for (const nombre of Object.keys(t).sort()) {
    const e = t[nombre]!;
    const columnas: Record<string, string[]> = {};
    for (const priv of Object.keys(e.columnas).sort()) {
      const cols = e.columnas[priv]!;
      if (cols.length > 0) columnas[priv] = [...cols].sort();
    }
    salida[nombre] = { tabla: [...e.tabla].sort(), columnas };
  }
  return salida;
}

async function permisosReales(): Promise<Record<string, EntradaTabla>> {
  // Toda relación de public que no sea un índice: tablas, vistas, secuencias, tablas foráneas.
  const relaciones = await dueno.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
    [manifiesto.esquema],
  );
  const real: Record<string, EntradaTabla> = {};
  for (const r of relaciones.rows) real[r.relname] = { tabla: [], columnas: {} };

  const deTabla = await dueno.query<{ relname: string; privilegio: string }>(
    `SELECT c.relname, a.privilege_type AS privilegio
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = $1 AND a.grantee = to_regrole($2)`,
    [manifiesto.esquema, manifiesto.rol],
  );
  for (const r of deTabla.rows) real[r.relname]?.tabla.push(r.privilegio);

  const deColumna = await dueno.query<{ relname: string; columna: string; privilegio: string }>(
    `SELECT c.relname, at.attname AS columna, a.privilege_type AS privilegio
       FROM pg_attribute at
       JOIN pg_class c ON c.oid = at.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(at.attacl) a
      WHERE n.nspname = $1 AND at.attnum > 0 AND NOT at.attisdropped
        AND a.grantee = to_regrole($2)`,
    [manifiesto.esquema, manifiesto.rol],
  );
  for (const r of deColumna.rows) {
    const e = real[r.relname];
    if (!e) continue;
    (e.columnas[r.privilegio] ??= []).push(r.columna);
  }
  return real;
}

describe("S-3 manifiesto de permisos de moneo_app", () => {
  it("el rol del manifiesto existe", async () => {
    const r = await dueno.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [manifiesto.rol]);
    expect(r.rowCount).toBe(1);
  });

  it("los permisos de tabla y de columna coinciden exactamente con prisma/permisos-moneo_app.json", async () => {
    expect(normalizar(await permisosReales())).toEqual(normalizar(manifiesto.tablas));
  });

  it("PUBLIC no tiene ningún permiso sobre las relaciones de public", async () => {
    const r = await dueno.query(
      `SELECT c.relname, a.privilege_type
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE n.nspname = $1 AND a.grantee = 0`,
      [manifiesto.esquema],
    );
    expect(r.rows).toEqual([]);
  });

  it("moneo_app usa el esquema public pero no puede crear objetos en él", async () => {
    const r = await dueno.query<{ usar: boolean; crear: boolean }>(
      `SELECT has_schema_privilege($1, $2, 'USAGE') AS usar,
              has_schema_privilege($1, $2, 'CREATE') AS crear`,
      [manifiesto.rol, manifiesto.esquema],
    );
    expect(r.rows[0]).toEqual({ usar: true, crear: false });
  });
});
