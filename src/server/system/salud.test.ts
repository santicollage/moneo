import { describe, expect, it } from "vitest";
import { crearLogger } from "../shared/log";
import { manejar } from "../shared/http/manejar";
import { crearGetSalud } from "./salud";

const ruta = (ok: boolean) =>
  manejar(
    { ruta: "/api/v1/health", metodo: "GET" },
    crearGetSalud(async () => ok),
    {
      log: crearLogger(() => {}),
    },
  );
const pedir = () => new Request("http://localhost:3000/api/v1/health");

describe("E-01 GET /api/v1/health", () => {
  it("200 con el cuerpo fijo { status: ok }, sin versión ni detalles", async () => {
    const r = await ruta(true)(pedir());
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"status":"ok"}');
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  it("503 unavailable si la base no responde", async () => {
    const r = await ruta(false)(pedir());
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ code: "unavailable", status: 503 });
  });
});
