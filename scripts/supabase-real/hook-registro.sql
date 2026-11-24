-- Moneo · F4-05b · Registro cerrado (S-7): catálogo del hook como el DUEÑO (postgres). SOLO LECTURA.
-- Lo que se puede ver desde la base: la función, su forma y quién puede ejecutarla, y que moneo_app
-- no llega al esquema. Que Auth TENGA el hook activado NO se ve aquí (es configuración del panel):
-- eso lo prueba probar-registro-cerrado.ps1. Nunca imprime correos: solo cuántos hay.
\set ON_ERROR_STOP 1
SET default_transaction_read_only = on;
\pset pager off
\pset format aligned

WITH
f AS (
  SELECT p.oid, p.prosecdef, p.proconfig, p.proacl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'signup_gate' AND p.proname = 'before_user_created'
),
ejecutores AS (
  SELECT r.rolname FROM f, pg_roles r
   WHERE has_function_privilege(r.oid, f.oid, 'EXECUTE')
     AND NOT r.rolsuper AND r.rolname NOT IN ('postgres', 'supabase_admin')
),
c(chequeo, ok, detalle) AS (
  SELECT 'función existe', EXISTS (SELECT 1 FROM f), '' UNION ALL
  SELECT 'SECURITY DEFINER', coalesce((SELECT prosecdef FROM f), false), '' UNION ALL
  SELECT 'search_path vacío', coalesce((SELECT proconfig @> ARRAY['search_path=""'] FROM f), false),
         coalesce((SELECT array_to_string(proconfig, ',') FROM f), '') UNION ALL
  SELECT 'solo supabase_auth_admin la ejecuta',
         (SELECT array_agg(rolname ORDER BY rolname) FROM ejecutores) = ARRAY['supabase_auth_admin']::name[],
         coalesce((SELECT string_agg(rolname, ',' ORDER BY rolname) FROM ejecutores), '(nadie)') UNION ALL
  SELECT 'moneo_app sin USAGE en signup_gate',
         NOT has_schema_privilege('moneo_app', 'signup_gate', 'USAGE'), '' UNION ALL
  SELECT 'anon/authenticated sin USAGE en signup_gate',
         NOT has_schema_privilege('anon', 'signup_gate', 'USAGE')
         AND NOT has_schema_privilege('authenticated', 'signup_gate', 'USAGE'), '' UNION ALL
  SELECT 'RLS activo en allowed_email',
         (SELECT relrowsecurity FROM pg_class WHERE oid = 'signup_gate.allowed_email'::regclass), '' UNION ALL
  SELECT 'la lista no está vacía (si lo está, nadie se registra)',
         (SELECT count(*) FROM signup_gate.allowed_email) > 0,
         (SELECT count(*)::text || ' correos' FROM signup_gate.allowed_email)
)
SELECT CASE WHEN ok THEN 'ok' ELSE 'FALLA' END AS r, chequeo, detalle FROM c
UNION ALL
SELECT CASE WHEN bool_and(ok) THEN ' RESUMEN ok' ELSE ' RESUMEN FALLA' END, '', '' FROM c;
