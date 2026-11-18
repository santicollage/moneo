-- Moneo · F4-03c · Permisos REALES de moneo_app en Supabase, con la forma de prisma/permisos-moneo_app.json.
-- SOLO LECTURA. Lo compara comparar-manifiesto.mjs (la misma normalización que tests/integration/db/manifiesto.test.ts).
-- Lee las ACL con aclexplode (no information_schema), por la misma razón que la prueba: ver qué se concedió por columna.
\set ON_ERROR_STOP 1
SET default_transaction_read_only = on;
\pset pager off
\t on
\a
WITH
rel AS (
  SELECT c.oid, c.relname, c.relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
),
de_tabla AS (
  SELECT r.relname,
         coalesce(jsonb_agg(a.privilege_type ORDER BY a.privilege_type)
                    FILTER (WHERE a.privilege_type IS NOT NULL), '[]'::jsonb) AS privs
    FROM rel r
    LEFT JOIN LATERAL aclexplode(r.relacl) a ON a.grantee = to_regrole('moneo_app')
   GROUP BY r.relname
),
de_columna AS (
  SELECT r.relname, a.privilege_type, jsonb_agg(at.attname ORDER BY at.attname) AS cols
    FROM rel r
    JOIN pg_attribute at ON at.attrelid = r.oid AND at.attnum > 0 AND NOT at.attisdropped
    CROSS JOIN LATERAL aclexplode(at.attacl) a
   WHERE a.grantee = to_regrole('moneo_app')
   GROUP BY r.relname, a.privilege_type
),
columnas AS (
  SELECT relname, jsonb_object_agg(privilege_type, cols) AS j FROM de_columna GROUP BY relname
)
SELECT jsonb_pretty(jsonb_build_object(
  'rol', 'moneo_app',
  'esquema', 'public',
  'tablas', coalesce(jsonb_object_agg(t.relname, jsonb_build_object(
              'tabla', t.privs, 'columnas', coalesce(c.j, '{}'::jsonb))), '{}'::jsonb)))
  FROM de_tabla t LEFT JOIN columnas c USING (relname);
