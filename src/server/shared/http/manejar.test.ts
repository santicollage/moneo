import { describe, expect, it, vi } from "vitest";
import { crearLogger } from "../log";
import { ErrorApi } from "./errores";
import { CUERPO_MAXIMO, manejar, type Manejador } from "./manejar";
import { CUERPO_404 } from "./problem";

const ORIGEN = "http://localhost:3000";
const ID = "3f2b1c9e-8a7d-4b6c-9e5f-1a2b3c4d5e6f";

function montar(fn: Manejador, metodo: "GET" | "POST" = "POST") {
  const lineas: string[] = [];
  const reportar = vi.fn();
  const h = manejar({ ruta: "/api/v1/spaces/:spaceId/movements", metodo }, fn, {
    appOrigin: () => ORIGEN,
    log: crearLogger((l) => lineas.push(l)),
    nuevoId: () => ID,
    reportar,
  });
  return { h, lineas, reportar };
}

const post = (cuerpo: string | null, cabeceras: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/v1/spaces/x/movements", {
    method: "POST",
    headers: { origin: ORIGEN, "content-type": "application/json", ...cabeceras },
    body: cuerpo,
  });

const eco: Manejador = async (ctx) =>
  Response.json({ recibido: await ctx.leerJson() }, { status: 201 });

describe("manejar(): orden T-2, cabeceras y errores", () => {
  it("toda respuesta lleva X-Request-Id, no-store y las cabeceras de seguridad", async () => {
    const { h } = montar(eco);
    const r = await h(post('{"a":1}'));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ recibido: { a: 1 } });
    expect(r.headers.get("X-Request-Id")).toBe(ID);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("Strict-Transport-Security")).toMatch(/max-age=(\d+)/);
  });

  it.each([
    ["Origin ajeno", { origin: "https://malo.example" }],
    ["sin Origin", { origin: "" }],
  ])("RNF-SEG-07: %s → 403 origin_mismatch y el manejador no corre", async (_n, cab) => {
    const fn = vi.fn(eco);
    const { h } = montar(fn);
    const pet = post("{}", cab);
    if (cab.origin === "") pet.headers.delete("origin");
    const r = await h(pet);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("origin_mismatch");
    expect(fn).not.toHaveBeenCalled();
  });

  it("GET no exige Origin", async () => {
    const { h } = montar(async () => Response.json({ ok: true }), "GET");
    const r = await h(new Request("http://localhost:3000/api/v1/x"));
    expect(r.status).toBe(200);
  });

  it("RNF-SEG-09: Content-Length > 16 KB → 413 antes del manejador (antes que la sesión, T-2)", async () => {
    const fn = vi.fn(eco);
    const { h } = montar(fn);
    const r = await h(post("{}", { "content-length": String(CUERPO_MAXIMO + 1) }));
    expect(r.status).toBe(413);
    expect(fn).not.toHaveBeenCalled();
  });

  it("RNF-SEG-09: cuerpo de 17 KB sin Content-Length fiable → 413 al leerlo", async () => {
    const { h } = montar(eco);
    const grande = JSON.stringify({ x: "a".repeat(17 * 1024) });
    const flujo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(grande));
        c.close();
      },
    });
    const pet = new Request("http://localhost:3000/api/v1/x", {
      method: "POST",
      headers: { origin: ORIGEN, "content-type": "application/json" },
      body: flujo,
      duplex: "half",
    } as RequestInit);
    expect((await h(pet)).status).toBe(413);
  });

  it("exactamente 16 KB pasa", async () => {
    const { h } = montar(eco);
    const relleno = "a".repeat(CUERPO_MAXIMO - '{"x":""}'.length);
    expect((await h(post(`{"x":"${relleno}"}`))).status).toBe(201);
  });

  it("JSON inválido o tipo distinto → 400 invalid_request sin el valor", async () => {
    const { h } = montar(eco);
    const r1 = await h(post("{mal"));
    expect(r1.status).toBe(400);
    expect(await r1.text()).not.toContain("{mal");
    const r2 = await h(post("a=1", { "content-type": "application/x-www-form-urlencoded" }));
    expect((await r2.json()).errors).toEqual([{ field: "body", rule: "content_type_json" }]);
  });

  it("cuerpo vacío → undefined (lo rechaza el esquema Zod de la ruta)", async () => {
    const { h } = montar(eco);
    expect(await (await h(post(null))).json()).toEqual({});
  });

  it("ErrorApi not_found → el 404 canónico byte a byte", async () => {
    const { h } = montar(async () => {
      throw new ErrorApi("not_found");
    });
    const r = await h(post("{}"));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(CUERPO_404);
  });

  it("R68: 55P03 por Prisma → 503 busy con Retry-After, nunca 500, y no se reporta", async () => {
    const { h, reportar } = montar(async () => {
      throw Object.assign(new Error("Raw query failed. Code: `55P03`"), {
        code: "P2010",
        meta: { driverAdapterError: { cause: { originalCode: "55P03", kind: "postgres" } } },
      });
    });
    const r = await h(post("{}"));
    expect(r.status).toBe(503);
    expect(r.headers.get("Retry-After")).toBe("1");
    expect((await r.json()).code).toBe("busy");
    expect(reportar).not.toHaveBeenCalled();
  });

  it("error desconocido → 500 internal solo con requestId, y se reporta con su código", async () => {
    const { h, reportar } = montar(async () => {
      throw new TypeError("no se puede leer saldo de undefined");
    });
    const r = await h(post("{}"));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({
      type: "urn:moneo:problem:internal",
      title: "Error interno",
      status: 500,
      code: "internal",
      requestId: ID,
    });
    expect(reportar).toHaveBeenCalledWith(expect.any(TypeError), {
      requestId: ID,
      ruta: "/api/v1/spaces/:spaceId/movements",
      errorCode: "TypeError",
    });
  });

  it("un reporte que falla no cambia la respuesta", async () => {
    const h = manejar(
      { ruta: "/api/v1/x", metodo: "GET" },
      async () => {
        throw new Error("x");
      },
      {
        log: crearLogger(() => {}),
        reportar: () => {
          throw new Error("sentry caído");
        },
      },
    );
    expect((await h(new Request("http://localhost:3000/api/v1/x"))).status).toBe(500);
  });
});

describe("RNF-PRI-01: los logs no reciben datos", () => {
  const MONTO = "987654321.12";
  const NOTA = "MARCADOR-NOTA-zx81";
  const RUTA_REAL = "/api/v1/spaces/1d6f0b8e-5c4a-4f2e-9b7d-0a1b2c3d4e5f/movements";

  it("ni el cuerpo, ni la ruta real, ni el mensaje de un error llegan al log", async () => {
    const casos: Manejador[] = [
      eco,
      async (ctx) => {
        await ctx.leerJson();
        throw new Error(`fallo con ${MONTO} y ${NOTA}`);
      },
      async () => {
        throw Object.assign(new Error(`Raw query failed: ${NOTA}`), {
          code: "P2010",
          meta: {
            driverAdapterError: {
              cause: { originalCode: "23505", kind: "postgres", message: NOTA },
            },
          },
        });
      },
      async () => {
        throw new ErrorApi("invalid_request", { errors: [{ field: "note", rule: "max_length" }] });
      },
    ];
    for (const fn of casos) {
      const { h, lineas } = montar(fn);
      const r = await h(
        new Request(`http://localhost:3000${RUTA_REAL}`, {
          method: "POST",
          headers: { origin: ORIGEN, "content-type": "application/json", cookie: `sb=${NOTA}` },
          body: JSON.stringify({ kind: "expense", amount: MONTO, note: NOTA }),
        }),
      );
      const todo = lineas.join("\n");
      expect(lineas.length).toBeGreaterThan(0);
      for (const marcador of [MONTO, NOTA, RUTA_REAL]) expect(todo).not.toContain(marcador);
      // La respuesta tampoco devuelve el mensaje interno (sí puede devolver el cuerpo en eco).
      if (r.status >= 500) expect(await r.text()).not.toContain(NOTA);
    }
  });
});
