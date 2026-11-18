-- Moneo · F4-03c · Lo que moneo_app puede y no puede HACER en Supabase real (S-1, seguridad.md §6.3).
-- Se conecta COMO moneo_app (puntos 1 y 2 de §6.4: el pooler acepta el rol propio).
-- Todo corre dentro de BEGIN … ROLLBACK: lo único que se escribe (una fila de rate_limit_counter)
-- se deshace al final. Es una muestra, no las 139 pruebas de F4-03b: las de comportamiento que
-- dependen del motor ya están probadas en Postgres 17; aquí se comprueba que el proyecto real se
-- comporta igual y que la conexión por el pooler llega con el rol correcto.
-- Falla (código de salida ≠ 0) si algo prohibido pasa o si algo permitido falla.
\set ON_ERROR_STOP 1
\pset pager off
BEGIN;
SELECT current_user AS usuario, current_setting('server_version') AS version;

DO $$
DECLARE
  fallas int := 0;
  t text;
  r record;
BEGIN
  IF current_user <> 'moneo_app' THEN
    RAISE EXCEPTION 'esta prueba debe correr como moneo_app, no como %', current_user;
  END IF;

  -- Debe poder leer cada tabla de negocio (con la política app_all; sin ella vería 0 filas en silencio).
  FOREACH t IN ARRAY ARRAY['profile', 'space', 'membership', 'invitation', 'account', 'category',
                           'subcategory', 'allocation', 'movement', 'audit_event', 'rate_limit_counter'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t);
    RAISE NOTICE 'ok     lee %', t;
  END LOOP;

  -- Debe poder insertar y luego ver lo insertado: prueba que la política existe y aplica (§6.2).
  -- Sin política, el INSERT falla con 42501 (new row violates row-level security policy).
  INSERT INTO rate_limit_counter (scope, key_hash, window_start, count)
       VALUES ('f4-03c-sonda', '\x00'::bytea, now(), 1);
  IF (SELECT count(*) FROM rate_limit_counter WHERE scope = 'f4-03c-sonda') <> 1 THEN
    fallas := fallas + 1;
    RAISE WARNING 'FALLA  insertó en rate_limit_counter pero no ve la fila (RLS sin política)';
  ELSE
    RAISE NOTICE 'ok     inserta y ve su fila en rate_limit_counter (política app_all activa)';
  END IF;

  -- No debe poder (cada uno debe fallar con 42501, insufficient_privilege).
  FOR r IN SELECT * FROM (VALUES
      ('UPDATE account SET opening_balance_cents = 0',     'saldo inicial inmutable (M-6, S-1)'),
      ('UPDATE account SET space_id = space_id',           'no se mueve una cuenta de espacio (M-17)'),
      ('UPDATE movement SET kind = kind',                  'kind inmutable (A-15)'),
      ('UPDATE membership SET role = role',                'el rol de la membresía no se edita'),
      ('UPDATE space SET deleted_at = NULL',               'borrar espacio llega con UC-08'),
      ('DELETE FROM movement',                             'sin borrado físico (RN-23)'),
      ('DELETE FROM audit_event',                          'auditoría de solo inserción (ADR-006)'),
      ('TRUNCATE rate_limit_counter',                      'sin TRUNCATE en ninguna tabla'),
      ('SELECT count(*) FROM _prisma_migrations',          'la app no lee la tabla de Prisma'),
      ('CREATE TABLE public.f403c_sonda (x int)',          'sin DDL'),
      ('ALTER TABLE account DISABLE ROW LEVEL SECURITY',   'no apaga RLS'),
      ('SET ROLE postgres',                                'no actúa como el dueño'),
      ('ALTER ROLE moneo_app BYPASSRLS',                   'no se da BYPASSRLS'),
      ('SELECT count(*) FROM auth.users',                  'la app no lee Auth')
    ) v(sentencia, por_que)
  LOOP
    BEGIN
      EXECUTE r.sentencia;
      fallas := fallas + 1;
      RAISE WARNING 'FALLA  pasó: % (%)', r.sentencia, r.por_que;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'ok     rechazada: %', r.sentencia;
      WHEN OTHERS THEN
        fallas := fallas + 1;
        RAISE WARNING 'FALLA  rechazada por OTRA causa (% %): %', SQLSTATE, SQLERRM, r.sentencia;
    END;
  END LOOP;

  IF fallas > 0 THEN
    RAISE EXCEPTION 'RESUMEN: % comprobaciones fallaron', fallas;
  END IF;
  RAISE NOTICE 'RESUMEN: ok';
END
$$;

ROLLBACK;
