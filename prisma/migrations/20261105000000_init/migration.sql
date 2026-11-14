-- Moneo · migración inicial BORRADOR (F3-02, 2026-11-05; revisión crítica aplicada el 2026-11-06)
-- Parte A: lo que generaría `prisma migrate dev` desde schema.prisma (escrito a mano en F3-02:
--          el motor de migraciones no se pudo descargar en el entorno; F4-03 regenera esta parte
--          con `prisma migrate dev --create-only` y comprueba que coincide).
-- Parte B: lo que Prisma no expresa (CHECK, RLS).
--          Se agrega a mano al final de la migración generada (Prisma lo conserva).
-- Revisión 2026-11-06: todas las FK con ON UPDATE RESTRICT (M-17), índice de S6 (M-18),
-- CHECK de fechas y periodos no futuros en hora de Bogotá (M-19).

-- ═════════════════════════ PARTE A ═════════════════════════

CREATE TYPE "space_kind" AS ENUM ('personal', 'shared');
CREATE TYPE "membership_role" AS ENUM ('owner', 'collaborator');
CREATE TYPE "account_type" AS ENUM ('savings', 'checking', 'wallet', 'cash', 'credit_card');
CREATE TYPE "holder_kind" AS ENUM ('member', 'shared');
CREATE TYPE "category_group" AS ENUM ('needs', 'wants', 'savings', 'investment');
CREATE TYPE "movement_kind" AS ENUM ('income', 'expense', 'refund', 'transfer', 'balance_adjustment', 'closing_adjustment');
CREATE TYPE "direction" AS ENUM ('inflow', 'outflow');
CREATE TYPE "audit_entity" AS ENUM ('space', 'membership', 'invitation', 'account', 'category', 'subcategory', 'allocation', 'movement');
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'void', 'archive', 'unarchive', 'delete');

CREATE TABLE "profile" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "space" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "space_kind" NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "space_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "membership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "type" "account_type" NOT NULL,
    "holder_kind" "holder_kind" NOT NULL,
    "holder_profile_id" UUID,
    "opened_on" DATE NOT NULL,
    "opening_balance_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "category" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" UUID NOT NULL,
    "group" "category_group" NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "name_key" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subcategory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "name_key" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "subcategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "allocation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "period" DATE NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "allocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "movement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" UUID NOT NULL,
    "kind" "movement_kind" NOT NULL,
    "direction" "direction",
    "amount_cents" BIGINT NOT NULL,
    "account_id" UUID NOT NULL,
    "counter_account_id" UUID,
    "category_id" UUID,
    "subcategory_id" UUID,
    "occurred_on" DATE NOT NULL,
    "note" VARCHAR(140),
    "client_request_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "movement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "entity" "audit_entity" NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" "audit_action" NOT NULL,
    "changes" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rate_limit_counter" (
    "scope" VARCHAR(32) NOT NULL,
    "key_hash" BYTEA NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "rate_limit_counter_pkey" PRIMARY KEY ("scope", "key_hash", "window_start")
);

CREATE INDEX "membership_profile_id_idx" ON "membership"("profile_id");
CREATE UNIQUE INDEX "membership_space_id_profile_id_key" ON "membership"("space_id", "profile_id");
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");
CREATE INDEX "invitation_space_id_idx" ON "invitation"("space_id");
CREATE INDEX "account_space_id_idx" ON "account"("space_id");
CREATE UNIQUE INDEX "account_id_space_id_key" ON "account"("id", "space_id");
CREATE INDEX "category_space_id_idx" ON "category"("space_id");
CREATE UNIQUE INDEX "category_id_space_id_key" ON "category"("id", "space_id");
CREATE UNIQUE INDEX "category_space_id_name_key_key" ON "category"("space_id", "name_key");
CREATE UNIQUE INDEX "subcategory_id_category_id_key" ON "subcategory"("id", "category_id");
CREATE UNIQUE INDEX "subcategory_category_id_name_key_key" ON "subcategory"("category_id", "name_key");
CREATE UNIQUE INDEX "invitation_one_open_per_space" ON "invitation"("space_id") WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX "membership_one_owner_per_space" ON "membership"("space_id") WHERE role = 'owner' AND ended_at IS NULL;
CREATE UNIQUE INDEX "membership_one_active_per_profile" ON "membership"("profile_id") WHERE ended_at IS NULL;
CREATE INDEX "allocation_space_id_period_idx" ON "allocation"("space_id", "period");
CREATE UNIQUE INDEX "allocation_category_id_period_key" ON "allocation"("category_id", "period");
CREATE INDEX "movement_list_cursor_idx" ON "movement"("space_id", "occurred_on" DESC, "created_at" DESC, "id" DESC);
CREATE INDEX "movement_account_id_idx" ON "movement"("account_id");
CREATE INDEX "movement_counter_account_id_idx" ON "movement"("counter_account_id");
CREATE INDEX "movement_space_id_category_id_occurred_on_idx" ON "movement"("space_id", "category_id", "occurred_on");
CREATE UNIQUE INDEX "movement_space_id_created_by_id_client_request_id_key" ON "movement"("space_id", "created_by_id", "client_request_id");
CREATE INDEX "audit_event_space_id_entity_entity_id_occurred_at_idx" ON "audit_event"("space_id", "entity", "entity_id", "occurred_at");

ALTER TABLE "space" ADD CONSTRAINT "space_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "membership" ADD CONSTRAINT "membership_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "membership" ADD CONSTRAINT "membership_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "account" ADD CONSTRAINT "account_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "account" ADD CONSTRAINT "account_holder_membership_fkey" FOREIGN KEY ("space_id", "holder_profile_id") REFERENCES "membership"("space_id", "profile_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "account" ADD CONSTRAINT "account_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "account" ADD CONSTRAINT "account_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "category" ADD CONSTRAINT "category_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "category" ADD CONSTRAINT "category_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "category" ADD CONSTRAINT "category_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_category_id_space_id_fkey" FOREIGN KEY ("category_id", "space_id") REFERENCES "category"("id", "space_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_category_id_space_id_fkey" FOREIGN KEY ("category_id", "space_id") REFERENCES "category"("id", "space_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movement" ADD CONSTRAINT "movement_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movement" ADD CONSTRAINT "movement_account_fkey" FOREIGN KEY ("account_id", "space_id") REFERENCES "account"("id", "space_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movement" ADD CONSTRAINT "movement_counter_account_fkey" FOREIGN KEY ("counter_account_id", "space_id") REFERENCES "account"("id", "space_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movement" ADD CONSTRAINT "movement_category_fkey" FOREIGN KEY ("category_id", "space_id") REFERENCES "category"("id", "space_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movement" ADD CONSTRAINT "movement_subcategory_fkey" FOREIGN KEY ("subcategory_id", "category_id") REFERENCES "subcategory"("id", "category_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movement" ADD CONSTRAINT "movement_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movement" ADD CONSTRAINT "movement_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movement" ADD CONSTRAINT "movement_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ═════════════════════════ PARTE B (a mano) ═════════════════════════
-- Ojo: las FK compuestas son MATCH SIMPLE. Si UNA columna es NULL, Postgres NO verifica la FK.
-- Por eso cada FK compuesta con columnas opcionales lleva un CHECK que fija cuándo puede ser NULL.

-- Nombres no vacíos (el servicio además hace trim)
ALTER TABLE "space"       ADD CONSTRAINT "space_name_not_blank"       CHECK (length(btrim("name")) > 0);
ALTER TABLE "account"     ADD CONSTRAINT "account_name_not_blank"     CHECK (length(btrim("name")) > 0);
ALTER TABLE "category"    ADD CONSTRAINT "category_name_not_blank"    CHECK (length(btrim("name")) > 0);
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "profile"     ADD CONSTRAINT "profile_display_name_not_blank" CHECK (length(btrim("display_name")) > 0);

-- Titular: miembro (FK compuesta a membership) o compartida (sin persona). D-19, UC-09 A1
ALTER TABLE "account" ADD CONSTRAINT "account_holder_consistent" CHECK (
  ("holder_kind" = 'shared' AND "holder_profile_id" IS NULL) OR
  ("holder_kind" = 'member' AND "holder_profile_id" IS NOT NULL)
);
-- Borrada y archivada son excluyentes (una cuenta borrada no tuvo movimientos)
ALTER TABLE "account" ADD CONSTRAINT "account_not_archived_and_deleted" CHECK ("archived_at" IS NULL OR "deleted_at" IS NULL);

-- Invitación
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_expiry_after_creation" CHECK ("expires_at" > "created_at");
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_pair" CHECK (("accepted_at" IS NULL) = ("accepted_by_id" IS NULL));
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_hash_len" CHECK (octet_length("token_hash") = 32);
-- (Índice parcial "una invitación abierta por espacio": en la parte A, lo declara schema.prisma.
--  Al generar una nueva, el servicio revoca la anterior, aunque ya haya vencido, en la misma transacción.)

-- Rol y fin de membresía
ALTER TABLE "membership" ADD CONSTRAINT "membership_end_after_start" CHECK ("ended_at" IS NULL OR "ended_at" >= "created_at");

-- Categorías: name_key = forma normalizada de name; la unicidad (RN-22) la declara schema.prisma
ALTER TABLE "category"    ADD CONSTRAINT "category_name_key_normalized"    CHECK ("name_key" = lower(btrim("name")));
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_name_key_normalized" CHECK ("name_key" = lower(btrim("name")));

-- Asignación: el periodo es el primer día del mes (RN-15). Sin CHECK de signo (RN-04).
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_period_first_day" CHECK (EXTRACT(DAY FROM "period") = 1);

-- Sin fechas ni periodos futuros (RN-15, RN-16, M-19). "Hoy" en America/Bogota, no en la zona
-- del servidor. Respaldo: el servicio valida con el reloj inyectado. Una fila válida nunca se
-- vuelve inválida ("hoy" solo avanza), así que restaurar un pg_dump no falla.
-- Costo: las pruebas no pueden insertar fechas posteriores al día real.
ALTER TABLE "movement"   ADD CONSTRAINT "movement_not_future"   CHECK ("occurred_on" <= (now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_not_future" CHECK ("period" <= date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date);

-- Movimientos (RN-08 a RN-14, RN-25, CT-06)
ALTER TABLE "movement" ADD CONSTRAINT "movement_amount_positive" CHECK ("amount_cents" > 0);
-- (F3-04 fija el monto máximo; entra como CHECK de magnitud en movement.amount_cents,
--  account.opening_balance_cents y allocation.amount_cents con el mismo número.)
ALTER TABLE "movement" ADD CONSTRAINT "movement_direction_by_kind" CHECK (
  ("kind" IN ('income', 'refund') AND "direction" = 'inflow') OR
  ("kind" = 'expense' AND "direction" = 'outflow') OR
  ("kind" IN ('balance_adjustment', 'closing_adjustment') AND "direction" IS NOT NULL) OR
  ("kind" = 'transfer' AND "direction" IS NULL)
);
ALTER TABLE "movement" ADD CONSTRAINT "movement_transfer_has_counter" CHECK (
  ("kind" = 'transfer') = ("counter_account_id" IS NOT NULL)
);
ALTER TABLE "movement" ADD CONSTRAINT "movement_transfer_distinct_accounts" CHECK (
  "counter_account_id" IS NULL OR "counter_account_id" <> "account_id"
);
ALTER TABLE "movement" ADD CONSTRAINT "movement_category_by_kind" CHECK (
  ("kind" IN ('expense', 'refund')) = ("category_id" IS NOT NULL)
);
-- Sin esto, MATCH SIMPLE dejaría pasar una subcategoría con category_id NULL
ALTER TABLE "movement" ADD CONSTRAINT "movement_subcategory_needs_category" CHECK (
  "subcategory_id" IS NULL OR "category_id" IS NOT NULL
);
ALTER TABLE "movement" ADD CONSTRAINT "movement_voided_pair" CHECK (("voided_at" IS NULL) = ("voided_by_id" IS NULL));

ALTER TABLE "rate_limit_counter" ADD CONSTRAINT "rate_limit_count_non_negative" CHECK ("count" >= 0);

-- RLS: activo en todas las tablas, sin políticas (D-06, ADR-003). Incluye la tabla de Prisma,
-- que también vive en public y la Data API expondría.
ALTER TABLE "profile"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "space"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcategory"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allocation"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "movement"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_event"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_limit_counter" ENABLE ROW LEVEL SECURITY;
-- _prisma_migrations: `migrate deploy` la crea ANTES de aplicar la primera migración, pero la base
-- sombra de `migrate dev` y `migrate diff` NO la tiene (F4-03a, R43: ERROR 42P01). Por eso el
-- ENABLE va protegido: en la base sombra se omite; en cualquier base real queda activo.
-- Como una omisión silenciosa sería un hueco, una prueba de integración (F4-03b) exige RLS
-- activo en TODA tabla de public, incluida esta.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;
