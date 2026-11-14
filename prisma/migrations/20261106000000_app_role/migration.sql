-- Moneo · F3-03 · Rol de la aplicación con mínimo privilegio (2026-11-06)
-- Documento: docs/seguridad.md §6 (S-1 a S-4). Se aplica DESPUÉS de la migración inicial.
-- Ejecuta: el dueño del esquema (postgres en Supabase) vía `prisma migrate deploy` por la conexión
-- directa o de sesión. En ejecución, la app NUNCA usa ese usuario: usa `moneo_app` por el pooler.
--
-- Por qué una migración y no un script aparte:
--   - Los permisos viven junto al schema y se versionan con él; una tabla nueva sin su GRANT
--     falla en la prueba de manifiesto de permisos (S-3) en vez de quedar abierta o inaccesible.
--   - Los roles son globales al clúster: la migración crea `moneo_app` SIN LOGIN si no existe, así
--     también funciona en la base sombra de `prisma migrate dev` y en el Postgres de CI.
--     LOGIN y contraseña se asignan fuera del repositorio, una vez por entorno (runbook de F3-06,
--     paso de F4-03): ALTER ROLE moneo_app LOGIN PASSWORD '<desde el gestor de secretos>';
--
-- Regla para migraciones futuras: toda tabla nueva lleva, en la MISMA migración, su
-- ENABLE ROW LEVEL SECURITY, su política para moneo_app y sus GRANT explícitos (o ninguno).

-- ─────────────── 1. Rol ───────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moneo_app') THEN
    CREATE ROLE moneo_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
  END IF;
END
$$;

-- Sin DDL: no es dueño de nada y no puede crear objetos en public.
REVOKE CREATE ON SCHEMA public FROM moneo_app;
GRANT USAGE ON SCHEMA public TO moneo_app;

-- ─────────────── 2. Cerrar la Data API (defensa en profundidad, D-06, RNF-SEG-10) ───────────────
-- Desde el 2026-10-30 Supabase ya no concede permisos automáticos a tablas nuevas de public,
-- pero se revoca explícito: no depende de la fecha de creación del proyecto ni de su configuración.
-- Los roles anon/authenticated/service_role solo existen en Supabase; en local y CI se omite.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- ─────────────── 3. RLS: una política por tabla, solo para moneo_app ───────────────
-- RLS está activo en todas las tablas sin políticas (migración inicial). Un rol que NO es dueño
-- y NO tiene BYPASSRLS ve CERO filas en esas tablas (verificado en PG 16.15). Por eso moneo_app
-- necesita una política explícita. anon y authenticated siguen sin ninguna: para ellos, 0 filas.
-- La autorización real NO está aquí: está en withPolicy + filtro por espacio (ADR-013).
CREATE POLICY app_all ON "profile"            FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "space"              FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "membership"         FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "invitation"         FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "account"            FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "category"           FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "subcategory"        FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "allocation"         FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "movement"           FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "audit_event"        FOR ALL TO moneo_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON "rate_limit_counter" FOR ALL TO moneo_app USING (true) WITH CHECK (true);
-- _prisma_migrations: sin política ni permisos para moneo_app.

-- ─────────────── 4. Permisos por tabla y por columna (M-17, ADR-006) ───────────────
-- Nunca actualizables: id, space_id, created_at, created_by_id (en todas), las inmutables de M-6
-- (holder_kind, holder_profile_id, opened_on, opening_balance_cents), la identidad de la celda
-- (allocation.category_id, period), movement.kind y client_request_id.
-- Sin DELETE salvo rate_limit_counter: el borrado de negocio es lógico (RN-23) y la purga física
-- es un script con el usuario dueño (M-12). Sin TRUNCATE en ninguna.

GRANT SELECT, INSERT ON "profile" TO moneo_app;
GRANT UPDATE ("display_name") ON "profile" TO moneo_app;

-- space: UPDATE (name) existe SOLO porque `SELECT … FOR UPDATE OF s` (bloqueo de M-4) exige
-- permiso de UPDATE sobre al menos una columna. No hay endpoint de renombrar en v1.
-- deleted_at llega con UC-08 (v1.1) en su propia migración.
GRANT SELECT, INSERT ON "space" TO moneo_app;
GRANT UPDATE ("name") ON "space" TO moneo_app;

-- membership: en v1 solo se crea (UC-03, UC-05). ended_at llega con UC-07 (v1.1).
GRANT SELECT, INSERT ON "membership" TO moneo_app;

GRANT SELECT, INSERT ON "invitation" TO moneo_app;
GRANT UPDATE ("accepted_at", "accepted_by_id", "revoked_at") ON "invitation" TO moneo_app;

GRANT SELECT, INSERT ON "account" TO moneo_app;
GRANT UPDATE ("name", "type", "archived_at", "deleted_at", "updated_at", "updated_by_id", "version") ON "account" TO moneo_app;

GRANT SELECT, INSERT ON "category" TO moneo_app;
GRANT UPDATE ("group", "name", "name_key", "archived_at", "updated_at", "updated_by_id", "version") ON "category" TO moneo_app;

GRANT SELECT, INSERT ON "subcategory" TO moneo_app;
GRANT UPDATE ("name", "name_key", "archived_at", "updated_at", "updated_by_id", "version") ON "subcategory" TO moneo_app;

GRANT SELECT, INSERT ON "allocation" TO moneo_app;
GRANT UPDATE ("amount_cents", "updated_at", "updated_by_id", "version") ON "allocation" TO moneo_app;

GRANT SELECT, INSERT ON "movement" TO moneo_app;
GRANT UPDATE ("direction", "amount_cents", "account_id", "counter_account_id", "category_id", "subcategory_id",
              "occurred_on", "note", "updated_at", "updated_by_id", "voided_at", "voided_by_id", "version")
  ON "movement" TO moneo_app;

-- audit_event: solo inserción y lectura (ADR-006).
GRANT SELECT, INSERT ON "audit_event" TO moneo_app;

-- rate_limit_counter: contador por ventana; DELETE para limpiar ventanas vencidas.
GRANT SELECT, INSERT, DELETE ON "rate_limit_counter" TO moneo_app;
GRANT UPDATE ("count") ON "rate_limit_counter" TO moneo_app;
