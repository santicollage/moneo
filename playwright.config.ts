/**
 * Playwright (F4-05c; T-1 y §8 de la estrategia de testing): solo Chromium, una prueba a la vez.
 *
 * - Local: reutiliza el `pnpm dev` que ya esté corriendo en localhost:3000 (con Supabase local).
 * - CI (job `e2e`): levanta `pnpm start` sobre el build del mismo job.
 * El servidor se da por listo cuando E-01 (`/api/v1/health`) responde 200: la base también contesta.
 * Sin reintentos: una prueba que solo pasa al segundo intento es un fallo que se esconde.
 */
import { defineConfig, devices } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const enCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: enCi,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: enCi ? [["list"], ["github"]] : "list",
  use: {
    baseURL: BASE,
    locale: "es-CO",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: enCi ? "pnpm start" : "pnpm dev",
    url: `${BASE}/api/v1/health`,
    reuseExistingServer: !enCi,
    timeout: 120_000,
  },
});
