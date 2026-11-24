-- Moneo · F4-05b · Registro cerrado con el hook «Before User Created» (S-7, F4-05-D1, F4-05b-D1)
--
-- Supabase Auth llama a `signup_gate.before_user_created(event)` antes de crear CADA usuario, venga
-- de E-02 o de un `signUp` directo con la clave publicable. Si el correo no está en
-- `signup_gate.allowed_email`, devuelve un error y el usuario no se crea.
--
-- Por qué un esquema propio y no `public` (F4-05b-D1):
--   - En `public` toda política apunta solo a moneo_app (rls.test.ts). Aquí moneo_app NO tiene
--     ningún permiso: ni USAGE sobre el esquema. La app no lee ni escribe la lista.
--   - `supabase_auth_admin` (el rol con que Auth habla con la base) solo puede EJECUTAR la función:
--     pregunta «¿este correo está permitido?» y no puede leer la lista entera.
--   - Prisma no administra este esquema (no está en schema.prisma): `migrate diff` lo ignora.
--   - La Data API solo expone `public`; además anon/authenticated/service_role no tienen permisos.
--
-- La función es SECURITY DEFINER con search_path vacío: corre con los permisos del dueño (el que
-- aplica las migraciones), que es dueño de la tabla. Solo hace un SELECT EXISTS.
-- La lista se carga a mano con `postgres` (runbook); los correos nunca van al repositorio.
-- Si la lista está vacía, NADIE se puede registrar: falla cerrado.

CREATE SCHEMA signup_gate;
REVOKE ALL ON SCHEMA signup_gate FROM PUBLIC;

CREATE TABLE signup_gate.allowed_email (
  email      TEXT        PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Igual que `claveCorreo` de src/server/shared/limite.ts (sin espacios, NFC, minúsculas).
  CONSTRAINT allowed_email_normalized CHECK (email = lower(normalize(btrim(email), NFC))),
  CONSTRAINT allowed_email_shape CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND length(email) <= 254)
);
ALTER TABLE signup_gate.allowed_email ENABLE ROW LEVEL SECURITY;
-- Sin políticas: quien no sea el dueño ve 0 filas aunque alguien le conceda SELECT por error.
REVOKE ALL ON signup_gate.allowed_email FROM PUBLIC;

CREATE FUNCTION signup_gate.before_user_created(event jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  correo text := lower(normalize(btrim(coalesce(event -> 'user' ->> 'email', '')), NFC));
BEGIN
  IF correo <> '' AND EXISTS (SELECT 1 FROM signup_gate.allowed_email a WHERE a.email = correo) THEN
    RETURN '{}'::jsonb;
  END IF;
  -- Forma de rechazo de la documentación del hook. El mensaje no dice nada del correo.
  RETURN jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'Signup not allowed')
  );
END
$$;

-- Postgres concede EXECUTE a PUBLIC por defecto en toda función nueva: se quita.
REVOKE ALL ON FUNCTION signup_gate.before_user_created(jsonb) FROM PUBLIC;

-- Solo Supabase tiene `supabase_auth_admin`; en el PG17 del CI y en la base sombra no existe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT USAGE ON SCHEMA signup_gate TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION signup_gate.before_user_created(jsonb) TO supabase_auth_admin;
  END IF;
END
$$;

-- Defensa en profundidad: aunque los privilegios por defecto cambiaran, nadie más la ejecuta.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'moneo_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA signup_gate FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA signup_gate FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION signup_gate.before_user_created(jsonb) FROM %I', r);
    END IF;
  END LOOP;
END
$$;
