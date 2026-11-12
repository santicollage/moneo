// Vitest 5 con dos proyectos (ADR-008; T-1 y T-5 de la estrategia de testing):
//   unit        → rápidas, sin red ni base de datos. Es lo que corre `pnpm test` y el pre-push.
//   integration → contra Postgres real (llega con F4-03/F4-05). `pnpm test:integration`.
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
          include: ["src/**/*.test.ts", "tests/lint/**/*.test.ts", "tests/politicas/**/*.test.ts"],
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
    ],
  },
});
