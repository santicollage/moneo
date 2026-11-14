import { defineConfig, env } from "prisma/config";

// Prisma 7: la URL de la base vive aquí y no en schema.prisma.
// Las migraciones las corre el DUEÑO del esquema (DB_OWNER_URL), nunca `moneo_app` (DATABASE_URL, S-4).
// No se carga ningún .env solo: se define en el shell o en el CI.
// SHADOW_DATABASE_URL es opcional y solo la usan `migrate diff --from-migrations` y `migrate dev`:
// debe apuntar a una base DEDICADA y vacía, porque Prisma la borra y la recrea.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: env("DB_OWNER_URL"),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
