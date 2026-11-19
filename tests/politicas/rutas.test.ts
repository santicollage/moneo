// F4-04b · «Hecho cuando»: una ruta sin `withPolicy` hace fallar el CI (D-14, T-3).
import { describe, expect, it } from "vitest";
import { RUTAS, type DefinicionRuta } from "../../src/contracts/shared/routes";
import { analizarRouteHandler, archivos, leer } from "./_analisis";

const ROOT = "src/app/api/v1";
const archivosRuta = archivos(ROOT, /\/route\.ts$/);

/** `src/app/api/v1/spaces/[spaceId]/accounts/route.ts` → `/api/v1/spaces/:spaceId/accounts` */
const patronDe = (archivo: string): string =>
  "/api/v1" +
  archivo
    .replaceAll("\\", "/")
    .slice(ROOT.length)
    .replace(/\/route\.ts$/, "")
    .replace(/\[(\w+)\]/g, ":$1");

describe("route.ts ↔ registro de rutas", () => {
  it("hay al menos un route.ts (la prueba no pasa en vacío)", () => {
    expect(archivosRuta.length).toBeGreaterThan(0);
  });

  it.each(archivosRuta)("%s usa manejar + withPolicy con un id del registro", (archivo) => {
    const info = analizarRouteHandler(leer(archivo));
    expect(info.usaManejar, "falta manejar(...)").toBe(true);
    expect(info.politicas, "falta withPolicy('E-xx', …)").toHaveLength(1);
    const def = RUTAS[info.politicas[0] as keyof typeof RUTAS] as
      (typeof RUTAS)[keyof typeof RUTAS] | undefined;
    expect(def, `${info.politicas[0]} no está en el registro`).toBeDefined();
    expect(info.ruta).toBe(def!.path);
    expect(info.metodo).toBe(def!.method);
    expect(patronDe(archivo)).toBe(def!.path);
  });

  it("toda ruta del registro tiene su route.ts", () => {
    const usadas = new Set(archivosRuta.flatMap((a) => analizarRouteHandler(leer(a)).politicas));
    expect([...Object.keys(RUTAS)].filter((id) => !usadas.has(id))).toEqual([]);
  });

  it("el registro es coherente: id = clave, sin duplicados, :spaceId en member y owner", () => {
    const vistos = new Set<string>();
    for (const [clave, def] of Object.entries(RUTAS) as [string, DefinicionRuta][]) {
      expect(def.id).toBe(clave);
      const llave = `${def.method} ${def.path}`;
      expect(vistos.has(llave), `duplicada: ${llave}`).toBe(false);
      vistos.add(llave);
      if (def.access === "member" || def.access === "owner") {
        expect(def.path).toContain("/:spaceId");
        expect(def.example.params?.spaceId).toBeDefined();
      }
    }
  });

  it("el detector sí atrapa una ruta sin withPolicy (prueba del propio control)", () => {
    const mala = `export const GET = manejar({ ruta: "/api/v1/x", metodo: "GET" }, async () => Response.json({}));`;
    expect(analizarRouteHandler(mala).politicas).toEqual([]);
    const comentada = `// withPolicy("E-01", …)\n${mala}`;
    expect(analizarRouteHandler(comentada).politicas).toEqual([]);
  });
});
