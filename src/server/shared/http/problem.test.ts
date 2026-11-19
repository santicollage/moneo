import { describe, expect, it } from "vitest";
import { CATALOGO, CUERPO_404, cuerpoProblema, respuestaProblema } from "./problem";

const ID = "3f2b1c9e-8a7d-4b6c-9e5f-1a2b3c4d5e6f";

describe("A-8 problem+json", () => {
  it("S-5: el 404 es siempre el mismo cuerpo, sin requestId ni extensiones", () => {
    expect(cuerpoProblema("not_found", ID)).toBe(CUERPO_404);
    expect(cuerpoProblema("not_found", "otro", { field: "accountId" })).toBe(CUERPO_404);
    expect(CUERPO_404).toBe(
      '{"type":"urn:moneo:problem:not_found","title":"No encontrado","status":404,"code":"not_found"}',
    );
  });

  it("orden fijo de claves y requestId al final", () => {
    expect(
      cuerpoProblema("invalid_request", ID, { errors: [{ field: "amount", rule: "money" }] }),
    ).toBe(
      `{"type":"urn:moneo:problem:invalid_request","title":"La petición no es válida","status":400,"code":"invalid_request","errors":[{"field":"amount","rule":"money"}],"requestId":"${ID}"}`,
    );
  });

  it("EN-7: balance_changed es 409; busy y unavailable son 503", () => {
    expect(CATALOGO.balance_changed.status).toBe(409);
    expect(CATALOGO.busy.status).toBe(503);
    expect(CATALOGO.unavailable.status).toBe(503);
  });

  it("busy lleva Retry-After: 1 y el tipo problem+json", async () => {
    const r = respuestaProblema("busy", ID);
    expect(r.status).toBe(503);
    expect(r.headers.get("Retry-After")).toBe("1");
    expect(r.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await r.json()).toMatchObject({ code: "busy", requestId: ID });
  });

  it("todo código del catálogo tiene un estado de error HTTP", () => {
    for (const { status } of Object.values(CATALOGO)) expect(status).toBeGreaterThanOrEqual(400);
  });
});
