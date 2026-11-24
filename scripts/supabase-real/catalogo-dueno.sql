-- Moneo · F4-03c · Comprobaciones de catálogo en Supabase real, como el DUEÑO (postgres).
-- SOLO LECTURA: la sesión se pone en modo de solo lectura antes de la primera consulta.
-- Cubre: versión, rol moneo_app (punto 1 de seguridad.md §6.4), membresía con ADMIN OPTION
-- (heredado de F4-03b), RLS y políticas, permisos de PUBLIC y de los roles de la Data API,
-- privilegios por defecto, lectura de auth.users/auth.identities (punto 6) y migraciones aplicadas.
-- Lo que NO cubre (otros scripts): el manifiesto exacto (manifiesto-real.sql), el comportamiento de
-- moneo_app (comportamiento-app.sql), pg_dump y la foto (probar-dump.sh), la Data API (probar-data-api.ps1).
-- Uso: ver scripts/supabase-real/verificar.ps1. Resultado: una fila por comprobación y una fila RESUMEN.
\set ON_ERROR_STOP 1
SET default_transaction_read_only = on;
\pset pager off
\pset format aligned

WITH
negocio(t) AS (
  VALUES ('profile'), ('space'), ('membership'), ('invitation'), ('account'), ('category'),
         ('subcategory'), ('allocation'), ('movement'), ('audit_event'), ('rate_limit_counter')
),
tablas AS (
  SELECT c.oid, c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
),
rol AS (SELECT * FROM pg_roles WHERE rolname = 'moneo_app'),
miembros AS (
  SELECT m.rolname AS miembro, am.admin_option, am.inherit_option, am.set_option
    FROM pg_auth_members am
    JOIN pg_roles r ON r.oid = am.roleid
    JOIN pg_roles m ON m.oid = am.member
   WHERE r.rolname = 'moneo_app'
),
politicas AS (
  SELECT tablename, policyname, cmd, roles, qual, with_check
    FROM pg_policies WHERE schemaname = 'public'
),
datapi(r) AS (VALUES ('anon'), ('authenticated'), ('service_role')),
c(punto, comprobacion, ok, detalle) AS (
  SELECT '0', 'Postgres 17 (misma versión mayor que local y CI, O-2)',
         current_setting('server_version_num')::int BETWEEN 170000 AND 179999,
         current_setting('server_version')
  UNION ALL
  SELECT '0', 'la sesión es del dueño (postgres), no de moneo_app',
         current_user <> 'moneo_app', current_user::text
  UNION ALL
  SELECT '1', 'el dueño puede crear roles (CREATEROLE)',
         (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user),
         'superusuario: ' || (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user)
  UNION ALL
  SELECT '1', 'moneo_app existe',
         EXISTS (SELECT 1 FROM rol), ''
  UNION ALL
  SELECT '1', 'moneo_app: sin super, BYPASSRLS, CREATEROLE, CREATEDB, INHERIT ni REPLICATION',
         coalesce((SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
                               OR rolinherit OR rolreplication) FROM rol), false),
         coalesce((SELECT format('super=%s bypassrls=%s createrole=%s createdb=%s inherit=%s replication=%s',
                   rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, rolreplication) FROM rol), 'sin rol')
  UNION ALL
  SELECT '1', 'moneo_app tiene LOGIN',
         coalesce((SELECT rolcanlogin FROM rol), false), ''
  UNION ALL
  SELECT '1', 'moneo_app sin VALID UNTIL vencido (el pooler respondería EAUTHQUERY)',
         coalesce((SELECT rolvaliduntil IS NULL OR rolvaliduntil > now() + interval '10 years' FROM rol), false),
         coalesce((SELECT coalesce(rolvaliduntil::text, 'sin fecha') FROM rol), '')
  UNION ALL
  SELECT '1', 'moneo_app no es miembro de ningún rol (no hereda permisos)',
         NOT EXISTS (SELECT 1 FROM pg_auth_members am JOIN rol ON rol.oid = am.member),
         coalesce((SELECT string_agg(r.rolname, ', ') FROM pg_auth_members am
                     JOIN rol ON rol.oid = am.member JOIN pg_roles r ON r.oid = am.roleid), '')
  UNION ALL
  SELECT 'H2', 'miembros de moneo_app: solo con ADMIN OPTION, sin SET ni INHERIT (F4-03b-D3)',
         NOT EXISTS (SELECT 1 FROM miembros
                      WHERE NOT (admin_option AND NOT inherit_option AND NOT set_option)),
         coalesce((SELECT string_agg(format('%s(admin=%s,inherit=%s,set=%s)', miembro, admin_option,
                   inherit_option, set_option), ', ') FROM miembros), 'ninguno')
  UNION ALL
  SELECT '1', 'moneo_app no es dueño de ningún objeto de public',
         NOT EXISTS (SELECT 1 FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE n.nspname = 'public' AND pg_get_userbyid(cl.relowner) = 'moneo_app'), ''
  UNION ALL
  SELECT '1', 'moneo_app usa public pero no crea objetos ahí',
         has_schema_privilege('moneo_app', 'public', 'USAGE')
           AND NOT has_schema_privilege('moneo_app', 'public', 'CREATE'), ''
  UNION ALL
  SELECT 'RLS', 'las 12 tablas de public existen (11 de negocio + _prisma_migrations)',
         (SELECT count(*) FROM tablas) = 12,
         (SELECT count(*)::text || ' tablas' FROM tablas)
  UNION ALL
  SELECT 'RLS', 'RLS activo en TODA tabla de public, incluida _prisma_migrations',
         NOT EXISTS (SELECT 1 FROM tablas WHERE NOT relrowsecurity),
         coalesce((SELECT string_agg(relname, ', ') FROM tablas WHERE NOT relrowsecurity), '')
  UNION ALL
  SELECT 'RLS', 'una sola política app_all por tabla de negocio: FOR ALL, solo moneo_app, USING/CHECK true',
         (SELECT count(*) FROM negocio n
            JOIN politicas p ON p.tablename = n.t AND p.policyname = 'app_all'
             AND p.cmd = 'ALL' AND p.roles = '{moneo_app}' AND p.qual = 'true' AND p.with_check = 'true') = 11,
         (SELECT count(*)::text || ' de 11' FROM negocio n
            JOIN politicas p ON p.tablename = n.t AND p.policyname = 'app_all'
             AND p.cmd = 'ALL' AND p.roles = '{moneo_app}' AND p.qual = 'true' AND p.with_check = 'true')
  UNION ALL
  SELECT 'RLS', 'ninguna otra política en public (ni en _prisma_migrations)',
         (SELECT count(*) FROM politicas) = 11,
         coalesce((SELECT string_agg(tablename || '.' || policyname, ', ') FROM politicas p
                    WHERE p.policyname <> 'app_all' OR p.tablename NOT IN (SELECT t FROM negocio)), '')
  UNION ALL
  SELECT 'S-2', 'PUBLIC sin permisos sobre relaciones de public',
         NOT EXISTS (SELECT 1 FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
                      CROSS JOIN LATERAL aclexplode(cl.relacl) a
                     WHERE n.nspname = 'public' AND a.grantee = 0), ''
  UNION ALL
  SELECT 'S-2', 'anon, authenticated y service_role: ningún permiso de tabla en public',
         NOT EXISTS (SELECT 1 FROM tablas t, datapi d
                      WHERE to_regrole(d.r) IS NOT NULL
                        AND (has_table_privilege(d.r, t.oid, 'SELECT') OR has_table_privilege(d.r, t.oid, 'INSERT')
                          OR has_table_privilege(d.r, t.oid, 'UPDATE') OR has_table_privilege(d.r, t.oid, 'DELETE'))),
         coalesce((SELECT string_agg(DISTINCT d.r || '→' || t.relname, ', ') FROM tablas t, datapi d
                    WHERE to_regrole(d.r) IS NOT NULL AND has_table_privilege(d.r, t.oid, 'SELECT')), '')
  UNION ALL
  SELECT 'S-2', 'anon, authenticated y service_role existen (si no, la comprobación de arriba no dice nada)',
         (SELECT count(*) FROM datapi WHERE to_regrole(r) IS NOT NULL) = 3, ''
  UNION ALL
  SELECT 'S-2', 'postgres (corre las migraciones) no concede nada por defecto a anon/authenticated/service_role',
         NOT EXISTS (SELECT 1 FROM pg_default_acl da
                      LEFT JOIN pg_namespace n ON n.oid = da.defaclnamespace
                      CROSS JOIN LATERAL aclexplode(da.defaclacl) a
                     WHERE da.defaclrole = 'postgres'::regrole
                       AND (n.nspname = 'public' OR da.defaclnamespace = 0)
                       AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))),
         coalesce((SELECT string_agg(DISTINCT format('%s:%s→%s', coalesce(n.nspname, '*'),
                     CASE da.defaclobjtype WHEN 'r' THEN 'tablas' WHEN 'S' THEN 'secuencias' WHEN 'f' THEN 'funciones'
                       WHEN 'T' THEN 'tipos' ELSE da.defaclobjtype::text END, pg_get_userbyid(a.grantee)), ', ')
                     FROM pg_default_acl da LEFT JOIN pg_namespace n ON n.oid = da.defaclnamespace
                     CROSS JOIN LATERAL aclexplode(da.defaclacl) a
                    WHERE da.defaclrole = 'postgres'::regrole
                      AND (n.nspname = 'public' OR da.defaclnamespace = 0)
                      AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))), '')
  UNION ALL
  SELECT 'info', 'privilegios por defecto de OTROS roles en public (supabase_admin: postgres no puede cambiarlos)',
         true,
         coalesce((SELECT string_agg(DISTINCT format('%s:%s→%s', pg_get_userbyid(da.defaclrole),
                     CASE da.defaclobjtype WHEN 'r' THEN 'tablas' WHEN 'S' THEN 'secuencias' WHEN 'f' THEN 'funciones'
                       WHEN 'T' THEN 'tipos' ELSE da.defaclobjtype::text END, pg_get_userbyid(a.grantee)), ', ')
                     FROM pg_default_acl da LEFT JOIN pg_namespace n ON n.oid = da.defaclnamespace
                     CROSS JOIN LATERAL aclexplode(da.defaclacl) a
                    WHERE da.defaclrole <> 'postgres'::regrole
                      AND (n.nspname = 'public' OR da.defaclnamespace = 0)
                      AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))), 'ninguno')
  UNION ALL
  SELECT '6', 'el dueño puede leer auth.users y auth.identities (respaldo de Auth, R51)',
         to_regclass('auth.users') IS NOT NULL AND to_regclass('auth.identities') IS NOT NULL
           AND has_table_privilege(current_user, 'auth.users', 'SELECT')
           AND has_table_privilege(current_user, 'auth.identities', 'SELECT'), ''
  UNION ALL
  SELECT '6', 'moneo_app NO puede leer auth.users',
         to_regclass('auth.users') IS NOT NULL
           AND NOT has_table_privilege('moneo_app', 'auth.users', 'SELECT'), ''
  UNION ALL
  -- 6 desde F4-05b: init, app_role, amount_limits, default_privileges, role_timeouts, signup_gate.
  SELECT 'MIG', 'las 6 migraciones aplicadas y terminadas, ninguna revertida',
         (SELECT count(*) FROM _prisma_migrations
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 6
           AND NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL),
         (SELECT string_agg(migration_name, ', ' ORDER BY migration_name) FROM _prisma_migrations)
  UNION ALL
  SELECT 'info', 'triggers de eventos del proyecto (no los crea Moneo; se anotan para comparar)',
         true, coalesce((SELECT string_agg(evtname, ', ' ORDER BY evtname) FROM pg_event_trigger), 'ninguno')
)
SELECT punto, comprobacion, CASE WHEN ok THEN 'ok' ELSE 'FALLA' END AS resultado, detalle FROM c
UNION ALL
SELECT 'RESUMEN', count(*) FILTER (WHERE NOT ok) || ' fallas de ' || count(*),
       CASE WHEN bool_and(ok) THEN 'ok' ELSE 'FALLA' END, '' FROM c;
