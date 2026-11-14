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

| Comando                 | Qué hace                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`              | Servidor de desarrollo                                                   |
| `pnpm build`            | Compilación de producción                                                |
| `pnpm lint`             | ESLint, incluidas las reglas de arquitectura                             |
| `pnpm typecheck`        | `tsc --noEmit`                                                           |
| `pnpm test`             | Pruebas unitarias y de las reglas de lint (proyecto `unit`)              |
| `pnpm test:integration` | Pruebas de la base como `moneo_app` contra un Postgres local (ver abajo) |
| `pnpm format`           | Prettier sobre todo el repositorio                                       |

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

## Pruebas de la base

`tests/integration/db` prueba lo que `prisma migrate diff` no ve: permisos de `moneo_app` (S-1), el manifiesto `prisma/permisos-moneo_app.json` (S-3), RLS y políticas (S-2), los CHECK de la migración (incluidos A-1 y M-19), las FK compuestas y los índices parciales. Cada prueba corre en una transacción que se deshace; el arnés solo acepta hosts locales.

**Una migración que cambie permisos cambia el manifiesto en el mismo PR.** Un CHECK nuevo necesita su caso en `restricciones.test.ts` (la prueba de cobertura falla si no lo tiene).

Con Supabase local (una vez por máquina, después de `pnpm exec supabase start` y `pnpm exec prisma migrate deploy`):

```powershell
# moneo_app se crea sin LOGIN en la migración; la contraseña local es tuya y no va al repositorio.
docker exec -i supabase_db_moneo psql -U postgres -c "ALTER ROLE moneo_app LOGIN PASSWORD '<elige una>'"
$env:TEST_APP_DATABASE_URL   = "postgresql://moneo_app:<la misma>@127.0.0.1:54322/postgres"
$env:TEST_OWNER_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
$env:EXPECT_SUPABASE_ROLES   = "1"
pnpm test:integration
```

En el CI corren en el job «Postgres 17», sin los roles de Supabase (la prueba de `anon`/`authenticated`/`service_role` se omite ahí y se repite contra staging en F5-07).

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
