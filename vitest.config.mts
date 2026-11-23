// Vitest 5 con dos proyectos (ADR-008; T-1 y T-5 de la estrategia de testing):
//   unit        → rápidas, sin red ni base de datos. Es lo que corre `pnpm test` y el pre-push.
//   integration → contra Postgres real como `moneo_app` (F4-03b: tests/integration/db). `pnpm test:integration`.
//   pooler-real → MANUAL contra el pooler de Supabase real, solo staging (F4-03d). `pnpm test:pooler-real`.
//   auth-local  → MANUAL contra Supabase Auth LOCAL (F4-05a, R49). `pnpm test:auth-local`.
// Cada proyecto declara su propio include: nada se "descubre" por accidente.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mismo alias que tsconfig.json ("@/*" → "./src/*").
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "tests/lint/**/*.test.ts",
            "tests/politicas/**/*.test.ts",
            "tests/autorizacion/**/*.test.ts",
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Comparten una base de datos: un archivo a la vez.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        // F4-03d: MANUAL contra Supabase real (staging). `pnpm test:pooler-real`; ni `pnpm test` ni el CI.
        resolve: { alias },
        test: {
          name: "pooler-real",
          environment: "node",
          include: ["tests/pooler-real/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 150_000,
          hookTimeout: 60_000,
        },
      },
      {
        // F4-05a: MANUAL contra Supabase local (Auth y JWKS reales). Ni `pnpm test` ni el CI.
        resolve: { alias },
        test: {
          name: "auth-local",
          environment: "node",
          include: ["tests/auth-local/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
