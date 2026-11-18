-- Moneo · F4-03c · Sin privilegios por defecto para los roles de la Data API (2026-11-17)
-- Hallazgo en el proyecto real de staging: Supabase deja privilegios por defecto (ALTER DEFAULT
-- PRIVILEGES) en public que conceden TODO sobre tablas, secuencias y funciones nuevas a anon,
-- authenticated y service_role cuando las crea `postgres` (el rol que corre `prisma migrate deploy`).
-- La migración del rol (20261106000000_app_role) revocó los permisos de lo que existía; esto cierra
-- lo que se cree DESPUÉS: sin ella, cada tabla de una migración futura nacería legible y escribible
-- por la Data API (S-2), y ni el manifiesto (que solo mira a moneo_app) ni el CI (sin esos roles) lo verían.
-- Prueba: tests/integration/db/rls.test.ts (corre donde existen los roles: Supabase local) y
-- scripts/supabase-real/catalogo-dueno.sql (staging y prod).
-- Límite: los privilegios por defecto de `supabase_admin` no se pueden cambiar desde `postgres`
-- (no es miembro de ese rol). Solo afectan a objetos que cree Supabase en public; Moneo nunca usa ese rol.
-- En local sin Supabase y en el PG17 del CI esos roles no existen: el bloque no hace nada.
DO $$
DECLARE
  r text;
  objeto text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    RETURN;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH objeto IN ARRAY ARRAY['TABLES', 'SEQUENCES', 'FUNCTIONS'] LOOP
        -- En el esquema public y a nivel global: los privilegios por defecto globales se SUMAN a los
        -- del esquema, así que un REVOKE solo en public no quitaría uno global.
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON %s FROM %I', objeto, r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON %s FROM %I', objeto, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
