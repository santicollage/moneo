# Moneo

Gestor de finanzas para pareja (PWA). Un solo paquete Next.js con TypeScript estricto; el dinero nunca es `float` (se guarda en centavos como `bigint`).

> Estado: F4 (cimientos). Todavía no hay funcionalidad de usuario.

## Requisitos

- Node.js 26.x (ver `.nvmrc`; `engines` lo exige).
- pnpm 11.28.11 (campo `packageManager`). No uses npm ni yarn: el repositorio solo tiene `pnpm-lock.yaml`.

## Empezar

```powershell
pnpm install                 # instala y activa los hooks de Git (script `prepare`)
Copy-Item .env.example .env  # y completa lo que necesites; nunca subas `.env`
pnpm dev                     # http://localhost:3000
```

Sin `pnpm install` no hay hooks: el commit y el push saldrían sin revisar.

## Scripts

| Comando                 | Qué hace                                                               |
| ----------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`              | Servidor de desarrollo                                                 |
| `pnpm build`            | Compilación de producción                                              |
| `pnpm lint`             | ESLint, incluidas las reglas de arquitectura                           |
| `pnpm typecheck`        | `tsc --noEmit`                                                         |
| `pnpm test`             | Pruebas unitarias y de las reglas de lint (proyecto `unit`)            |
| `pnpm test:integration` | Pruebas contra Postgres real (proyecto `integration`; vacío por ahora) |
| `pnpm format`           | Prettier sobre todo el repositorio                                     |

## Estructura

| Carpeta         | Contenido                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `src/domain`    | Reglas de negocio en TypeScript puro: sin Next, React, Prisma ni Supabase                        |
| `src/server`    | Servicios y repositorios. Reciben un `actor` explícito; Prisma solo en `shared/db` y `*.repo.ts` |
| `src/contracts` | Esquemas Zod: el contrato de la API (tipos, validación y cliente)                                |
| `src/app`       | Páginas y Route Handlers de `/api/v1`                                                            |
| `tests`         | Pruebas fuera de `src` (reglas de lint, integración)                                             |
| `scripts`       | Respaldo y restauración cifrados (`scripts/backup`)                                              |

Las reglas de dependencia las hace cumplir ESLint (`eslint.config.mjs`) y están probadas en `tests/lint`. Si una regla estorba, no la apagues: cambia la regla y su prueba juntas.

## Commits

Conventional Commits, validados por commitlint: `tipo(alcance opcional): asunto`.

- `pre-commit`: Prettier y ESLint sobre los archivos en staging.
- `pre-push`: `pnpm typecheck` y `pnpm test`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) corre en Linux lo mismo que los ganchos (formato, lint, tipos, pruebas y build), más gitleaks, `pnpm audit` y un Postgres 17. `main` solo recibe cambios por pull request con el check `ci-ok` en verde. Los ganchos locales se pueden saltar con `--no-verify`; el CI no.

Las reglas de los workflows (acciones fijadas por SHA, permisos mínimos) y la de no usar variables públicas de Supabase las hacen cumplir las pruebas de `tests/politicas`.

## Seguridad

- Nada de secretos, claves ni datos reales en el repositorio. `.env.example` solo lleva nombres.
- Los datos financieros se acceden solo desde código de servidor; el navegador no usa el cliente de Supabase.
