// ESLint 10 (config plana) con las reglas de arquitectura de Moneo.
//
// Por qué existe este archivo: ADR-001, ADR-013 y EN-14 (docs/15-revision-g3.md §7)
// pasan de "lint o revisión" a SOLO LINT. Cada regla lleva un identificador [ARQ-xx]
// en su mensaje y tiene su prueba en tests/lint/arquitectura.test.ts.
// Si cambias una regla, cambia su prueba; si una prueba falla, la regla no protege nada.
//
// Importante (flat config): cuando dos bloques configuran la misma regla, el último
// REEMPLAZA al anterior (no se mezclan). Por eso cada alcance de abajo declara su lista
// completa a través de los constructores importes() y sintaxis().
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------------
// Mensajes (el prefijo [ARQ-xx] lo usan las pruebas)
// ---------------------------------------------------------------------------
const MSG = {
  domainFramework:
    "[ARQ-01] src/domain es TypeScript puro: no importa Next, React, Prisma ni Supabase (ADR-001, D-04).",
  domainCapas:
    "[ARQ-02] src/domain no puede importar src/server ni src/app: la dependencia va hacia adentro (ADR-001).",
  useServer:
    '[ARQ-03] Prohibido "use server": cero Server Actions en v1 (D-12, ADR-001). Usa un Route Handler de /api/v1.',
  nextServerOnly:
    "[ARQ-04] next/headers y next/cache no se usan en src/app/api ni en src/server: los servicios reciben un `actor`, no el contexto de Next (D-14, T-5).",
  prismaTodo:
    "[ARQ-05] Prisma solo se toca desde src/server/shared/db y los archivos *.repo.ts (EN-14, B0-6). Los servicios nunca ven `prisma`.",
  prismaRepo:
    "[ARQ-05] En un *.repo.ts solo se importan TIPOS de Prisma (`import type`). La instancia vive en src/server/shared/db y el repositorio recibe `tx` (EN-14, B0-6).",
  transaction:
    "[ARQ-06] $transaction solo dentro de src/server/shared/db/locks.ts (withSpaceLock / withInvitationLock). Una transacción suelta se salta el bloqueo del espacio (EN-14, M-4, EN-5).",
  unsafeRaw:
    "[ARQ-07] $queryRawUnsafe y $executeRawUnsafe están prohibidos: usa $queryRaw / $executeRaw con plantilla etiquetada (parametrizada).",
  rawSeguro:
    "[ARQ-08] $queryRaw y $executeRaw solo se usan en src/server/shared/db y en archivos *.repo.ts.",
  only: "[ARQ-09] Prohibido .only: dejaría el resto de las pruebas sin correr sin que nadie lo note.",
};

// ---------------------------------------------------------------------------
// Constructores
// ---------------------------------------------------------------------------

/** Selector que detecta `x.nombre`, `x["nombre"]` y `{ nombre }` (desestructuración). */
const miembro = (...nombres) =>
  nombres
    .flatMap((n) => [
      `MemberExpression[property.name='${n}']`,
      `MemberExpression[property.value='${n}']`,
      `Property[key.name='${n}']`,
    ])
    .join(", ");

const SEL = {
  useServer: "ExpressionStatement[directive='use server']",
  transaction: miembro("$transaction"),
  unsafeRaw: miembro("$queryRawUnsafe", "$executeRawUnsafe"),
  rawSeguro: miembro("$queryRaw", "$executeRaw"),
  only: "CallExpression > MemberExpression.callee[property.name='only'][object.name=/^(it|test|describe|suite|bench)$/]",
};

/**
 * Reglas de sintaxis de un alcance.
 * @param {{ transaction?: boolean, rawSeguro?: boolean }} permite Lo que ese alcance SÍ puede usar.
 */
function sintaxis({ transaction = false, rawSeguro = false } = {}) {
  const reglas = [
    { selector: SEL.useServer, message: MSG.useServer },
    { selector: SEL.unsafeRaw, message: MSG.unsafeRaw },
    { selector: SEL.only, message: MSG.only },
  ];
  if (!transaction) reglas.push({ selector: SEL.transaction, message: MSG.transaction });
  if (!rawSeguro) reglas.push({ selector: SEL.rawSeguro, message: MSG.rawSeguro });
  return ["error", ...reglas];
}

const PRISMA_PATHS = ["@prisma/client", "@prisma/adapter-pg"];
const PRISMA_PATTERNS = [
  "@prisma/**",
  "**/shared/db/generated",
  "**/shared/db/generated/**",
  "**/shared/db/client",
  "**/shared/db/client.*",
];

/**
 * Restricciones de importación de un alcance.
 * @param {{ domain?: boolean, nextServerOnly?: boolean, prisma: "todo" | "tipos" | "libre" }} o
 */
function importes({ domain = false, nextServerOnly = false, prisma }) {
  const paths = [];
  const patterns = [];

  if (domain) {
    for (const name of ["next", "react", "react-dom", "@supabase/supabase-js", "@supabase/ssr"]) {
      paths.push({ name, message: MSG.domainFramework });
    }
    patterns.push(
      {
        group: ["next/**", "react/**", "react-dom/**", "@supabase/**"],
        message: MSG.domainFramework,
      },
      {
        group: ["@/server", "@/server/**", "@/app", "@/app/**", "**/server/**", "**/app/**"],
        message: MSG.domainCapas,
      },
    );
  }

  if (nextServerOnly) {
    for (const name of ["next/headers", "next/cache"]) {
      paths.push({ name, message: MSG.nextServerOnly });
    }
  }

  if (prisma !== "libre") {
    // En el dominio, Prisma se reporta como regla del dominio (ARQ-01), no como ARQ-05.
    const message = domain
      ? MSG.domainFramework
      : prisma === "tipos"
        ? MSG.prismaRepo
        : MSG.prismaTodo;
    const allowTypeImports = prisma === "tipos";
    for (const name of PRISMA_PATHS) paths.push({ name, message, allowTypeImports });
    patterns.push({ group: PRISMA_PATTERNS, message, allowTypeImports });
  }

  return ["error", { paths, patterns }];
}

/** Un alcance = qué archivos + qué reglas de arquitectura les tocan. */
const alcance = (files, { imp, sint }) => ({
  files,
  rules: {
    // La versión de typescript-eslint entiende `import type`; la base se apaga (lo pide su doc).
    "no-restricted-imports": "off",
    "@typescript-eslint/no-restricted-imports": imp,
    "no-restricted-syntax": sint,
  },
});

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
export default defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/server/shared/db/generated/**",
  ]),

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Promesas: una escritura financiera sin `await` compila, casi siempre funciona y
  // falla en silencio (respuesta antes de tiempo, error perdido, bloqueo liberado antes).
  // Estas reglas necesitan los tipos del proyecto; por eso solo aplican a archivos de
  // src/ y tests/ que están dentro del tsconfig (los .mjs y la config quedan fuera).
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        // En React es normal pasar `async () => {}` a un onClick/onSubmit.
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // Next.js: reglas del plugin oficial (sustituye a eslint-config-next, ver B1-c).
  nextPlugin.configs["core-web-vitals"],

  // Hooks de React.
  reactHooks.configs.flat.recommended,

  // --- Arquitectura, de lo más general a lo más específico (gana el último bloque) ---

  // 1) Todo lo que hay en src/: sin Prisma, sin "use server", sin $transaction ni SQL crudo.
  alcance(["src/**/*.{ts,tsx}"], {
    imp: importes({ prisma: "todo" }),
    sint: sintaxis(),
  }),

  // 2) API y servidor: además, sin next/headers ni next/cache.
  alcance(["src/app/api/**/*.ts", "src/server/**/*.ts"], {
    imp: importes({ nextServerOnly: true, prisma: "todo" }),
    sint: sintaxis(),
  }),

  // 3) Repositorios: solo tipos de Prisma; SQL parametrizado permitido; $transaction no.
  alcance(["src/server/**/*.repo.ts"], {
    imp: importes({ nextServerOnly: true, prisma: "tipos" }),
    sint: sintaxis({ rawSeguro: true }),
  }),

  // 4) La capa de base de datos: aquí vive la instancia de Prisma.
  alcance(["src/server/shared/db/**/*.ts"], {
    imp: importes({ nextServerOnly: true, prisma: "libre" }),
    sint: sintaxis({ rawSeguro: true }),
  }),

  // 5) El único archivo donde puede existir $transaction.
  alcance(["src/server/shared/db/locks.ts"], {
    imp: importes({ nextServerOnly: true, prisma: "libre" }),
    sint: sintaxis({ rawSeguro: true, transaction: true }),
  }),

  // 6) Dominio: TypeScript puro, sin framework ni capas externas.
  alcance(["src/domain/**/*.ts"], {
    imp: importes({ domain: true, prisma: "todo" }),
    sint: sintaxis(),
  }),

  // 7) Pruebas fuera de src/: pueden importar lo que necesiten, pero ni $transaction ni .only.
  alcance(["tests/**/*.{ts,tsx}"], {
    imp: importes({ prisma: "libre" }),
    sint: sintaxis({ rawSeguro: true }),
  }),
]);
