import { describe, expect, it } from "vitest";
import { crearLogger, filtrar, type CamposLog } from "./log";

const ID = "3f2b1c9e-8a7d-4b6c-9e5f-1a2b3c4d5e6f";

describe("ADR-011 logger con lista permitida", () => {
  it("deja pasar solo los campos permitidos y válidos", () => {
    expect(
      filtrar("request", "info", {
        route: "/api/v1/spaces/:spaceId/movements",
        method: "POST",
        status: 201,
        durationMs: 12.6,
        requestId: ID,
        spaceId: ID,
        errorCode: "55P03",
      }),
    ).toEqual({
      level: "info",
      event: "request",
      route: "/api/v1/spaces/:spaceId/movements",
      method: "POST",
      status: 201,
      durationMs: 13,
      requestId: ID,
      spaceId: ID,
      errorCode: "55P03",
    });
  });

  it.each([
    ["ruta real con un UUID", { route: `/api/v1/spaces/${ID}` }],
    ["ruta con consulta", { route: "/api/v1/health?x=1" }],
    ["*Id que no es UUID", { accountId: "Nequi de Ana" }],
    ["campo fuera de la lista", { amount: "23500.00" }],
    ["errorCode con un mensaje", { errorCode: "duplicate key value violates unique constraint" }],
    ["status fuera de rango", { status: 42 }],
  ])("descarta %s sin su valor", (_n, campos) => {
    const salida = filtrar("request", "info", campos);
    expect(salida.dropped).toBe(1);
    expect(JSON.stringify(salida)).not.toContain(String(Object.values(campos)[0]));
  });

  it("evento desconocido → invalid_event", () => {
    expect(filtrar("el usuario Ana gastó 20.000", "warn").event).toBe("invalid_event");
  });

  it("escribe una línea JSON por llamada", () => {
    const lineas: string[] = [];
    const log = crearLogger(
      (l) => lineas.push(l),
      () => new Date("2026-11-18T00:00:00Z"),
    );
    log.error("db_pool_error", { errorCode: "25P03" });
    expect(lineas).toEqual([
      '{"ts":"2026-11-18T00:00:00.000Z","level":"error","event":"db_pool_error","errorCode":"25P03"}',
    ]);
  });

  it("el tipo rechaza un campo fuera de la lista (prueba de compilación)", () => {
    // @ts-expect-error `note` no está en CamposLog
    const campos: CamposLog = { note: "mercado" };
    expect(campos).toBeDefined();
  });
});
