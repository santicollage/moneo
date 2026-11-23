// F4-04c · `openapi.json` versionado y vigilado por el CI (A-16, R17).
// Si cambias el registro de rutas, regenera con `pnpm openapi` y revisa el diff: es el control de
// deriva del contrato (R17). En el CI (CI=true) Vitest nunca reescribe el archivo: si no coincide, falla.
import { describe, expect, it } from "vitest";
import { CATALOGO } from "../../src/server/shared/http/problem";
import { RUTAS, type DefinicionRuta } from "../../src/contracts/shared/routes";
import { codigosDeError, documentoOpenApi, textoOpenApi } from "./_openapi";

describe("OpenAPI generado desde el registro de rutas", () => {
  it("openapi.json está al día con el registro (si falla: `pnpm openapi`)", async () => {
    await expect(textoOpenApi()).toMatchFileSnapshot("../../openapi.json");
  });

  it("cada ruta del registro aparece con su operationId, método y perfil", () => {
    const doc = documentoOpenApi() as unknown as {
      paths: Record<string, Record<string, { operationId: string; "x-moneo-access": string }>>;
      servers?: unknown;
    };
    expect(doc.servers).toBeUndefined();
    for (const def of Object.values(RUTAS) as DefinicionRuta[]) {
      const op = doc.paths[def.path.replace(/:(\w+)/g, "{$1}")]?.[def.method.toLowerCase()];
      expect(op?.operationId, def.id).toBe(def.id);
      expect(op?.["x-moneo-access"]).toBe(def.access);
    }
  });

  it("los errores de cada ruta existen en el catálogo de problem.ts", () => {
    for (const def of Object.values(RUTAS) as DefinicionRuta[]) {
      for (const c of def.errors) expect(Object.keys(CATALOGO), `${def.id}: ${c}`).toContain(c);
    }
  });

  it("los errores salen del perfil: una ruta member documenta 401 y 404; un POST, Origin y 16 KB", () => {
    const base: Omit<DefinicionRuta, "method" | "access"> = {
      id: "E-xx",
      path: "/api/v1/spaces/:spaceId/x",
      action: "x.y",
      example: {},
      errors: [],
      output: {},
    };
    expect(codigosDeError({ ...base, method: "GET", access: "member" })).toEqual([
      "busy",
      "internal",
      "not_found",
      "unauthenticated",
    ]);
    expect(codigosDeError({ ...base, method: "POST", access: "owner" })).toEqual([
      "busy",
      "forbidden",
      "internal",
      "invalid_request",
      "not_found",
      "origin_mismatch",
      "payload_too_large",
      "unauthenticated",
    ]);
  });
});
