/**
 * F4-04c · `openapi.json` sale del registro de rutas (ADR-007, A-16, `12-diseno-api.md` §1.10).
 *
 * Es documentación DERIVADA: el contrato son los esquemas Zod de `RUTAS`. Aquí solo se traduce:
 *   - `:param` → `{param}`; `id` (E-xx) → `operationId`; `action` y `access` como extensiones `x-moneo-*`.
 *   - Cuerpo de la petición: `RUTAS[…].input` (F4-05b).
 *   - Respuestas de éxito: `RUTAS[…].output`.
 *   - Errores: los propios de la ruta + los que puede dar su perfil de acceso (MATRIZ) + los de
 *     infraestructura de `manejar()` (Origin, 16 KB, 500, 503 `busy`), agrupados por estado.
 * Vive en `tests/` porque `zod-openapi` es solo de desarrollo: no llega al código de la app.
 * Sin `servers`: el documento no se sirve en producción (API9 de OWASP).
 */
import { z } from "zod";
import { createDocument } from "zod-openapi";
import { CATALOGO, type CodigoProblema } from "../../src/server/shared/http/problem";
import { MATRIZ, RUTAS, type DefinicionRuta } from "../../src/contracts/shared/routes";

const CODIGOS = Object.keys(CATALOGO) as [CodigoProblema, ...CodigoProblema[]];

/** RFC 9457 tal como lo arma `problem.ts`. El 404 no lleva `requestId` (S-5). */
const Problema = z
  .object({
    type: z.string().meta({ example: "urn:moneo:problem:too_many_attempts" }),
    title: z.string(),
    status: z.int(),
    code: z.enum(CODIGOS),
    requestId: z.uuid().optional(),
    errors: z.array(z.object({ field: z.string(), rule: z.string() })).optional(),
  })
  .meta({ id: "Problem", description: "RFC 9457. El cliente decide por `code`." });

/** Rechazos que puede dar cada perfil, con su código (T-3). */
const RECHAZO: Record<number, CodigoProblema> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "already_in_space",
};

export function codigosDeError(def: DefinicionRuta): CodigoProblema[] {
  const codigos = new Set<CodigoProblema>(def.errors as CodigoProblema[]);
  for (const r of Object.values(MATRIZ[def.access])) {
    if (r !== "ok") codigos.add(RECHAZO[r]!);
  }
  if (def.method !== "GET") {
    codigos.add("origin_mismatch");
    codigos.add("payload_too_large");
    codigos.add("invalid_request");
  }
  codigos.add("internal");
  codigos.add("busy");
  return [...codigos].sort();
}

function respuestas(def: DefinicionRuta) {
  const salida: Record<string, unknown> = {};
  for (const [estado, esquema] of Object.entries(def.output)) {
    salida[estado] =
      esquema === null
        ? { description: `Éxito (${estado}), sin cuerpo` }
        : {
            description: `Éxito (${estado})`,
            content: { "application/json": { schema: esquema } },
          };
  }
  const porEstado = new Map<number, CodigoProblema[]>();
  for (const c of codigosDeError(def)) {
    const s = CATALOGO[c].status;
    porEstado.set(s, [...(porEstado.get(s) ?? []), c]);
  }
  for (const [estado, codigos] of [...porEstado].sort(([a], [b]) => a - b)) {
    const reintento = codigos.some((c) => c === "busy" || c === "too_many_attempts");
    salida[String(estado)] = {
      description: codigos.map((c) => `\`${c}\``).join(", "),
      ...(reintento
        ? { headers: { "Retry-After": { schema: { type: "integer", minimum: 1 } } } }
        : {}),
      content: { "application/problem+json": { schema: Problema } },
    };
  }
  return salida;
}

export function documentoOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const def of Object.values(RUTAS) as DefinicionRuta[]) {
    const ruta = def.path.replace(/:(\w+)/g, "{$1}");
    const params = [...def.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
    paths[ruta] ??= {};
    paths[ruta][def.method.toLowerCase()] = {
      operationId: def.id,
      summary: def.action,
      "x-moneo-action": def.action,
      "x-moneo-access": def.access,
      ...(params.length > 0
        ? {
            requestParams: {
              path: z.object(Object.fromEntries(params.map((p) => [p, z.uuid()]))),
            },
          }
        : {}),
      ...(def.input
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: def.input } },
            },
          }
        : {}),
      responses: respuestas(def),
    };
  }
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Moneo API",
      version: "v1",
      description:
        "Generado desde src/contracts/shared/routes.ts (F4-04c). No editar a mano: `pnpm openapi`.",
    },
    paths: paths as Parameters<typeof createDocument>[0]["paths"],
  });
}

/** Texto exacto que se versiona: JSON con 2 espacios y salto de línea final. */
export function textoOpenApi(): string {
  return `${JSON.stringify(documentoOpenApi(), null, 2)}\n`;
}
