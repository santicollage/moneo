/**
 * Pruebas de las reglas de arquitectura de eslint.config.mjs (ADR-001, ADR-013, EN-14).
 *
 * Una regla de lint sin una prueba que demuestre que FALLA cuando debe no protege nada.
 * Cada caso lintea un texto como si fuera el archivo `ruta` (el archivo no tiene que existir):
 * lo que decide qué reglas aplican es la ruta.
 *
 * - "debe fallar":  el lint tiene que reportar la regla [ARQ-xx].
 * - "debe pasar":   el lint NO debe reportar ninguna regla [ARQ-xx] (otras reglas, como estilo, no cuentan).
 */
import { ESLint } from "eslint";
import { describe, expect, it, vi } from "vitest";

// El primer lint con tipos arranca el servicio de proyecto de TypeScript: en frío tarda varios
// segundos (5,5 s medidos en Windows). Solo este archivo necesita más margen que el valor por
// defecto (5 s); el resto de las pruebas unitarias conserva el suyo.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Para las reglas ARQ-xx las rutas son simuladas (el archivo no existe), así que no hay tipos
// que leer: se apagan solo las reglas que los necesitan. Esas reglas tienen su propio bloque
// más abajo, sobre archivos reales (tests/lint/_tipos.ts y _tipos-jsx.tsx).
const eslint = new ESLint({
  overrideConfigFile: "eslint.config.mjs",
  cwd: process.cwd(),
  ignore: false,
  overrideConfig: [
    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: { parserOptions: { projectService: false } },
      rules: {
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-misused-promises": "off",
      },
    },
  ],
});

const eslintConTipos = new ESLint({
  overrideConfigFile: "eslint.config.mjs",
  cwd: process.cwd(),
  ignore: false,
});

/** Reglas de lint (por nombre) que se reportan para ese texto, con los tipos del proyecto. */
async function reglasConTipos(codigo: string, ruta = "tests/lint/_tipos.ts"): Promise<string[]> {
  const [resultado] = await eslintConTipos.lintText(codigo, { filePath: ruta });
  expect(resultado, `el lint no devolvió resultado para ${ruta}`).toBeDefined();
  const fatales = resultado!.messages.filter((m) => m.fatal);
  expect(
    fatales,
    `error de parseo en ${ruta}: ${fatales.map((m) => m.message).join(" | ")}`,
  ).toEqual([]);
  return resultado!.messages.map((m) => m.ruleId).filter((r): r is string => r !== null);
}

/** Devuelve los identificadores [ARQ-xx] que el lint reportó para ese texto en esa ruta. */
async function reglasDeArquitectura(ruta: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(codigo, { filePath: ruta });
  expect(resultado, `el lint no devolvió resultado para ${ruta}`).toBeDefined();
  const fatales = resultado!.messages.filter((m) => m.fatal);
  expect(
    fatales,
    `error de parseo en ${ruta}: ${fatales.map((m) => m.message).join(" | ")}`,
  ).toEqual([]);
  return resultado!.messages
    .map((m) => /\[(ARQ-\d{2})\]/.exec(m.message)?.[1])
    .filter((id): id is string => id !== undefined);
}

type Caso = { nombre: string; ruta: string; codigo: string };

function pruebaDe(id: string, titulo: string, fallan: Caso[], pasan: Caso[]) {
  describe(`${id} ${titulo}`, () => {
    for (const c of fallan) {
      it(`debe fallar: ${c.nombre}`, async () => {
        expect(await reglasDeArquitectura(c.ruta, c.codigo)).toContain(id);
      });
    }
    for (const c of pasan) {
      it(`debe pasar: ${c.nombre}`, async () => {
        expect(await reglasDeArquitectura(c.ruta, c.codigo)).not.toContain(id);
      });
    }
  });
}

pruebaDe(
  "ARQ-01",
  "src/domain no importa framework",
  [
    {
      nombre: "importa next",
      ruta: "src/domain/a.ts",
      codigo: 'import { NextResponse } from "next/server";\nexport const x = NextResponse;',
    },
    {
      nombre: "importa next (raíz)",
      ruta: "src/domain/a.ts",
      codigo: 'import next from "next";\nexport const x = next;',
    },
    {
      nombre: "importa react",
      ruta: "src/domain/a.ts",
      codigo: 'import { useState } from "react";\nexport const x = useState;',
    },
    {
      nombre: "importa @prisma/client",
      ruta: "src/domain/a.ts",
      codigo: 'import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;',
    },
    {
      nombre: "importa supabase",
      ruta: "src/domain/a.ts",
      codigo:
        'import { createClient } from "@supabase/supabase-js";\nexport const x = createClient;',
    },
    {
      nombre: "importa supabase/ssr",
      ruta: "src/domain/a.ts",
      codigo:
        'import { createServerClient } from "@supabase/ssr";\nexport const x = createServerClient;',
    },
  ],
  [
    {
      nombre: "importa otro archivo del dominio",
      ruta: "src/domain/a.ts",
      codigo: 'import { b } from "./b";\nexport const x = b;',
    },
    {
      nombre: "importa zod",
      ruta: "src/domain/a.ts",
      codigo: 'import { z } from "zod";\nexport const x = z;',
    },
    {
      nombre: "next en src/app es válido",
      ruta: "src/app/layout.tsx",
      codigo: 'import Link from "next/link";\nexport const x = Link;',
    },
  ],
);

pruebaDe(
  "ARQ-02",
  "src/domain no importa src/server ni src/app",
  [
    {
      nombre: "alias @/server",
      ruta: "src/domain/a.ts",
      codigo: 'import { s } from "@/server/spaces/space.service";\nexport const x = s;',
    },
    {
      nombre: "alias @/app",
      ruta: "src/domain/a.ts",
      codigo: 'import { p } from "@/app/page";\nexport const x = p;',
    },
    {
      nombre: "ruta relativa a server",
      ruta: "src/domain/money/a.ts",
      codigo: 'import { s } from "../../server/shared/db";\nexport const x = s;',
    },
  ],
  [
    {
      nombre: "alias @/domain",
      ruta: "src/domain/a.ts",
      codigo: 'import { d } from "@/domain/money";\nexport const x = d;',
    },
    {
      nombre: "alias @/contracts",
      ruta: "src/domain/a.ts",
      codigo: 'import { m } from "@/contracts/shared/money";\nexport const x = m;',
    },
  ],
);

pruebaDe(
  "ARQ-03",
  'prohibido "use server"',
  [
    {
      nombre: "directiva a nivel de archivo",
      ruta: "src/app/actions.ts",
      codigo: '"use server";\nexport async function guardar() {}',
    },
    {
      nombre: "directiva dentro de una función",
      ruta: "src/app/page.tsx",
      codigo:
        'export function F() {\n  async function guardar() {\n    "use server";\n  }\n  return guardar;\n}',
    },
    {
      nombre: "en src/server",
      ruta: "src/server/a.ts",
      codigo: '"use server";\nexport const x = 1;',
    },
  ],
  [
    {
      nombre: '"use client" es válido',
      ruta: "src/app/boton.tsx",
      codigo: '"use client";\nexport function B() { return null; }',
    },
    {
      nombre: 'la cadena "use server" dentro de un texto no es directiva',
      ruta: "src/app/a.ts",
      codigo: 'export const texto = "use server";',
    },
  ],
);

pruebaDe(
  "ARQ-04",
  "sin next/headers ni next/cache en src/app/api y src/server",
  [
    {
      nombre: "next/headers en src/server",
      ruta: "src/server/spaces/a.ts",
      codigo: 'import { cookies } from "next/headers";\nexport const x = cookies;',
    },
    {
      nombre: "next/cache en src/server",
      ruta: "src/server/spaces/a.ts",
      codigo: 'import { revalidatePath } from "next/cache";\nexport const x = revalidatePath;',
    },
    {
      nombre: "next/headers en src/app/api",
      ruta: "src/app/api/v1/health/route.ts",
      codigo: 'import { headers } from "next/headers";\nexport const x = headers;',
    },
    {
      nombre: "next/cache en un repositorio",
      ruta: "src/server/spaces/space.repo.ts",
      codigo: 'import { revalidateTag } from "next/cache";\nexport const x = revalidateTag;',
    },
    {
      nombre: "next/headers en la capa db",
      ruta: "src/server/shared/db/client.ts",
      codigo: 'import { headers } from "next/headers";\nexport const x = headers;',
    },
  ],
  [
    {
      nombre: "next/headers en una página es válido",
      ruta: "src/app/page.tsx",
      codigo: 'import { headers } from "next/headers";\nexport const x = headers;',
    },
    {
      nombre: "next/server en un Route Handler es válido",
      ruta: "src/app/api/v1/health/route.ts",
      codigo: 'import { NextResponse } from "next/server";\nexport const x = NextResponse;',
    },
  ],
);

pruebaDe(
  "ARQ-05",
  "Prisma solo en db/** y *.repo.ts (solo tipos en el repo)",
  [
    {
      nombre: "servicio importa @prisma/client",
      ruta: "src/server/spaces/space.service.ts",
      codigo: 'import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;',
    },
    {
      nombre: "servicio importa el cliente generado",
      ruta: "src/server/spaces/space.service.ts",
      codigo:
        'import { Prisma } from "@/server/shared/db/generated/client";\nexport const x = Prisma;',
    },
    {
      nombre: "servicio importa la instancia",
      ruta: "src/server/spaces/space.service.ts",
      codigo: 'import { prisma } from "@/server/shared/db/client";\nexport const x = prisma;',
    },
    {
      nombre: "servicio importa un tipo de Prisma (tampoco)",
      ruta: "src/server/spaces/space.service.ts",
      codigo:
        'import type { Prisma } from "@prisma/client";\nexport type X = Prisma.SpaceWhereInput;',
    },
    {
      nombre: "Route Handler importa Prisma",
      ruta: "src/app/api/v1/spaces/route.ts",
      codigo: 'import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;',
    },
    {
      nombre: "componente importa Prisma",
      ruta: "src/app/page.tsx",
      codigo: 'import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;',
    },
    {
      nombre: "contratos importa Prisma",
      ruta: "src/contracts/shared/a.ts",
      codigo: 'import { Prisma } from "@prisma/client";\nexport const x = Prisma;',
    },
    {
      nombre: "repositorio importa valores de Prisma",
      ruta: "src/server/spaces/space.repo.ts",
      codigo: 'import { Prisma } from "@prisma/client";\nexport const x = Prisma;',
    },
    {
      nombre: "repositorio importa la instancia",
      ruta: "src/server/spaces/space.repo.ts",
      codigo: 'import { prisma } from "@/server/shared/db/client";\nexport const x = prisma;',
    },
    {
      nombre: "repositorio importa un valor del cliente generado",
      ruta: "src/server/spaces/space.repo.ts",
      codigo:
        'import { Prisma } from "@/server/shared/db/generated/client";\nexport const x = Prisma;',
    },
    {
      nombre: "subruta de @prisma",
      ruta: "src/server/spaces/space.service.ts",
      codigo: 'import { x } from "@prisma/client/runtime/library";\nexport const y = x;',
    },
  ],
  [
    {
      nombre: "repositorio con import type",
      ruta: "src/server/spaces/space.repo.ts",
      codigo:
        'import type { Prisma } from "@prisma/client";\nexport type X = Prisma.SpaceWhereInput;',
    },
    {
      nombre: "repositorio con import type del cliente generado",
      ruta: "src/server/spaces/space.repo.ts",
      codigo:
        'import type { Prisma } from "@/server/shared/db/generated/client";\nexport type X = Prisma.SpaceWhereInput;',
    },
    {
      nombre: "repositorio con import { type X }",
      ruta: "src/server/spaces/space.repo.ts",
      codigo:
        'import { type Prisma } from "@prisma/client";\nexport type X = Prisma.SpaceWhereInput;',
    },
    {
      nombre: "la capa db importa el cliente",
      ruta: "src/server/shared/db/client.ts",
      codigo: 'import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;',
    },
    {
      nombre: "la capa db importa el adaptador",
      ruta: "src/server/shared/db/client.ts",
      codigo: 'import { PrismaPg } from "@prisma/adapter-pg";\nexport const x = PrismaPg;',
    },
    {
      nombre: "un servicio importa los bloqueos desde la capa db",
      ruta: "src/server/spaces/space.service.ts",
      codigo:
        'import { withSpaceLock } from "@/server/shared/db";\nexport const x = withSpaceLock;',
    },
  ],
);

pruebaDe(
  "ARQ-06",
  "$transaction solo en src/server/shared/db/locks.ts",
  [
    {
      nombre: "en un servicio",
      ruta: "src/server/spaces/space.service.ts",
      codigo: "export const x = (db: any) => db.$transaction(async () => {});",
    },
    {
      nombre: "con corchetes",
      ruta: "src/server/spaces/space.service.ts",
      codigo: "export const x = (db: any) => db['$transaction'](async () => {});",
    },
    {
      nombre: "desestructurado",
      ruta: "src/server/spaces/space.service.ts",
      codigo:
        "export const x = (db: any) => { const { $transaction } = db; return $transaction; };",
    },
    {
      nombre: "en un repositorio",
      ruta: "src/server/spaces/space.repo.ts",
      codigo: "export const x = (db: any) => db.$transaction(async () => {});",
    },
    {
      nombre: "en la capa db fuera de locks.ts",
      ruta: "src/server/shared/db/client.ts",
      codigo: "export const x = (db: any) => db.$transaction(async () => {});",
    },
    {
      nombre: "en un Route Handler",
      ruta: "src/app/api/v1/spaces/route.ts",
      codigo: "export const x = (db: any) => db.$transaction(async () => {});",
    },
    {
      nombre: "en una prueba (sin excepción, B0-7)",
      ruta: "tests/integration/a.test.ts",
      codigo: "export const x = (db: any) => db.$transaction(async () => {});",
    },
    {
      nombre: "en una prueba dentro de src",
      ruta: "src/server/spaces/space.test.ts",
      codigo: "export const x = (db: any) => db.$transaction(async () => {});",
    },
  ],
  [
    {
      nombre: "en locks.ts",
      ruta: "src/server/shared/db/locks.ts",
      codigo: "export const x = (db: any) => db.$transaction(async () => {});",
    },
  ],
);

pruebaDe(
  "ARQ-07",
  "prohibido $queryRawUnsafe y $executeRawUnsafe (en todo el repo)",
  [
    {
      nombre: "$queryRawUnsafe en un repositorio",
      ruta: "src/server/spaces/space.repo.ts",
      codigo: "export const x = (db: any, s: string) => db.$queryRawUnsafe(s);",
    },
    {
      nombre: "$executeRawUnsafe en la capa db",
      ruta: "src/server/shared/db/client.ts",
      codigo: "export const x = (db: any, s: string) => db.$executeRawUnsafe(s);",
    },
    {
      nombre: "$queryRawUnsafe en locks.ts",
      ruta: "src/server/shared/db/locks.ts",
      codigo: "export const x = (db: any, s: string) => db.$queryRawUnsafe(s);",
    },
    {
      nombre: "$queryRawUnsafe en una prueba",
      ruta: "tests/integration/a.test.ts",
      codigo: "export const x = (db: any, s: string) => db.$queryRawUnsafe(s);",
    },
    {
      nombre: "con corchetes",
      ruta: "src/server/spaces/space.repo.ts",
      codigo: "export const x = (db: any, s: string) => db['$queryRawUnsafe'](s);",
    },
  ],
  [
    {
      nombre: "$queryRaw con plantilla etiquetada en un repositorio",
      ruta: "src/server/spaces/space.repo.ts",
      codigo: "export const x = (db: any, id: string) => db.$queryRaw`SELECT 1 WHERE id = ${id}`;",
    },
  ],
);

pruebaDe(
  "ARQ-08",
  "$queryRaw y $executeRaw solo en db/** y *.repo.ts",
  [
    {
      nombre: "$queryRaw en un servicio",
      ruta: "src/server/spaces/space.service.ts",
      codigo: "export const x = (db: any) => db.$queryRaw`SELECT 1`;",
    },
    {
      nombre: "$executeRaw en un servicio",
      ruta: "src/server/spaces/space.service.ts",
      codigo: "export const x = (db: any) => db.$executeRaw`UPDATE a SET b = 1`;",
    },
    {
      nombre: "$queryRaw en un Route Handler",
      ruta: "src/app/api/v1/spaces/route.ts",
      codigo: "export const x = (db: any) => db.$queryRaw`SELECT 1`;",
    },
    {
      nombre: "$queryRaw en el dominio",
      ruta: "src/domain/a.ts",
      codigo: "export const x = (db: any) => db.$queryRaw`SELECT 1`;",
    },
  ],
  [
    {
      nombre: "$queryRaw en un repositorio",
      ruta: "src/server/spaces/space.repo.ts",
      codigo: "export const x = (db: any) => db.$queryRaw`SELECT 1`;",
    },
    {
      nombre: "$queryRaw en la capa db",
      ruta: "src/server/shared/db/locks.ts",
      codigo: "export const x = (db: any) => db.$queryRaw`SELECT 1 FOR UPDATE`;",
    },
    {
      nombre: "$queryRaw en una prueba de integración",
      ruta: "tests/integration/a.test.ts",
      codigo: "export const x = (db: any) => db.$queryRaw`SELECT 1`;",
    },
  ],
);

pruebaDe(
  "ARQ-09",
  "prohibido .only",
  [
    { nombre: "it.only", ruta: "src/domain/a.test.ts", codigo: 'it.only("a", () => {});' },
    { nombre: "describe.only", ruta: "tests/a.test.ts", codigo: 'describe.only("a", () => {});' },
    { nombre: "test.only", ruta: "src/server/a.test.ts", codigo: 'test.only("a", () => {});' },
  ],
  [
    { nombre: "it normal", ruta: "src/domain/a.test.ts", codigo: 'it("a", () => {});' },
    {
      nombre: "una propiedad llamada only en un objeto",
      ruta: "src/domain/a.ts",
      codigo: "export const x = { only: true };",
    },
  ],
);

describe("regla de sintaxis: ninguna regla se pisa con otra", () => {
  it("un mismo archivo recibe a la vez ARQ-03, ARQ-05 y ARQ-06 (los bloques no se reemplazan entre sí)", async () => {
    const ids = await reglasDeArquitectura(
      "src/server/spaces/space.service.ts",
      '"use server";\nimport { PrismaClient } from "@prisma/client";\nexport const x = (db: any) => db.$transaction(async () => {});\nexport const y = PrismaClient;',
    );
    expect(ids).toEqual(expect.arrayContaining(["ARQ-03", "ARQ-05", "ARQ-06"]));
  });
});

// ---------------------------------------------------------------------------
// Promesas (reglas con tipos): una escritura sin `await` falla en silencio.
// ---------------------------------------------------------------------------
const FLOTANTE = "@typescript-eslint/no-floating-promises";
const MAL_USADA = "@typescript-eslint/no-misused-promises";

describe("PROM-01 promesa sin await (no-floating-promises)", () => {
  const fallan: [string, string][] = [
    ["llamada async sin await", "async function a() {}\nexport async function b() { a(); }"],
    [
      "escritura dentro de un bloqueo de espacio sin await (el caso que preocupa)",
      [
        "declare function withSpaceLock(id: string, f: (tx: object) => Promise<void>): Promise<void>;",
        "declare function actualizarSaldo(tx: object): Promise<void>;",
        "export async function registrar() {",
        '  await withSpaceLock("espacio", async (tx) => {',
        "    actualizarSaldo(tx);",
        "  });",
        "}",
      ].join("\n"),
    ],
    [
      "withSpaceLock en sí mismo sin await",
      [
        "declare function withSpaceLock(id: string, f: () => Promise<void>): Promise<void>;",
        'export async function registrar() { withSpaceLock("espacio", async () => {}); }',
      ].join("\n"),
    ],
    ["then sin manejar el error", "export function a() { Promise.resolve(1).then(() => {}); }"],
  ];
  const pasan: [string, string][] = [
    ["con await", "async function a() {}\nexport async function b() { await a(); }"],
    ["con return", "async function a() {}\nexport function b() { return a(); }"],
    ["con void explícito", "async function a() {}\nexport function b() { void a(); }"],
    [
      "then con catch",
      "export function a() { Promise.resolve(1).then(() => {}).catch(() => {}); }",
    ],
    [
      "Promise.all con await",
      "async function a() {}\nexport async function b() { await Promise.all([a(), a()]); }",
    ],
  ];
  for (const [nombre, codigo] of fallan) {
    it(`debe fallar: ${nombre}`, async () => {
      expect(await reglasConTipos(codigo)).toContain(FLOTANTE);
    });
  }
  for (const [nombre, codigo] of pasan) {
    it(`debe pasar: ${nombre}`, async () => {
      expect(await reglasConTipos(codigo)).not.toContain(FLOTANTE);
    });
  }
});

describe("PROM-02 promesa donde se espera un valor o una función sin resultado (no-misused-promises)", () => {
  it("debe fallar: async dentro de forEach (nadie espera su resultado)", async () => {
    const codigo =
      "export function a() { [1, 2].forEach(async (n) => { await Promise.resolve(n); }); }";
    expect(await reglasConTipos(codigo)).toContain(MAL_USADA);
  });
  it("debe fallar: promesa usada como condición (siempre es verdadera)", async () => {
    const codigo =
      "async function ok() { return false; }\nexport function a() { if (ok()) { return 1; } return 0; }";
    expect(await reglasConTipos(codigo)).toContain(MAL_USADA);
  });
  it("debe pasar: for...of con await", async () => {
    const codigo =
      "export async function a() { for (const n of [1, 2]) { await Promise.resolve(n); } }";
    expect(await reglasConTipos(codigo)).not.toContain(MAL_USADA);
  });
  it("debe pasar: manejador async en un atributo JSX (normal en React)", async () => {
    const codigo =
      "export const B = () => <button onClick={async () => { await Promise.resolve(); }} />;";
    expect(await reglasConTipos(codigo, "tests/lint/_tipos-jsx.tsx")).not.toContain(MAL_USADA);
  });
});
