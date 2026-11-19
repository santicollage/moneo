// F4-04b · «Hecho cuando»: un repositorio sin `spaceId` hace fallar el CI (EN-14, D-14).
import { describe, expect, it } from "vitest";
import { archivos, funcionesSinSpaceId, leer } from "./_analisis";

const repos = archivos("src/server", /\.repo\.ts$/);

describe("repositorios: firma (tx, spaceId, …)", () => {
  it.each(repos.length > 0 ? repos : [null])("%s", (archivo) => {
    if (archivo === null) return; // aún no hay repositorios: el primero llega en F5-01
    expect(funcionesSinSpaceId(leer(archivo))).toEqual([]);
  });

  it("el detector atrapa funciones sin spaceId (prueba del propio control)", () => {
    const mala = `
      export async function listar(tx: Tx, limit: number) {}
      export const contar = async (tx: Tx) => 1;
      export async function ok(tx: Tx, spaceId: string, id: string) {}
      export const ok2 = async (tx: Tx, spaceId: string) => 1;
    `;
    expect(funcionesSinSpaceId(mala)).toEqual(["listar", "contar"]);
  });
});
