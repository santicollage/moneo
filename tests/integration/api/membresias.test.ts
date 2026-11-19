/* eslint-disable no-restricted-syntax --
   F4-04b: `$transaction` solo para deshacer los datos de la prueba (lanza al final y Prisma hace ROLLBACK).
   En la app, `$transaction` solo existe en `locks.ts` (ARQ-06). */
/**
 * F4-04b · Las lecturas de membresía de `withPolicy` contra Postgres real como `moneo_app`
 * (ADR-013, M-4): solo cuenta una membresía activa (`ended_at IS NULL`) en un espacio no borrado.
 * Los datos se insertan como `moneo_app` (que solo tiene SELECT e INSERT) dentro de una transacción
 * que siempre se deshace: nada que limpiar y nada que dependa del orden.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { crearPrisma } from "@/server/shared/db/client";
import type { PrismaClient } from "@/server/shared/db/generated/client";
import { rolEnEspacio, tieneEspacio } from "@/server/shared/db/membresias";
import { crearLogger } from "@/server/shared/log";

const URL_APP = process.env.TEST_APP_DATABASE_URL;
if (!URL_APP)
  throw new Error("TEST_APP_DATABASE_URL no está definida (ver README, «Pruebas de la base»).");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(URL_APP).hostname)) {
  throw new Error("Estas pruebas solo corren contra un Postgres local.");
}

const prisma: PrismaClient = crearPrisma(
  { url: URL_APP, local: true, ca: undefined },
  crearLogger(() => {}),
);
afterAll(async () => {
  await prisma.$disconnect();
});

class Deshacer extends Error {}

describe("F4-04b membresías contra Postgres real", () => {
  it("rolEnEspacio y tieneEspacio: solo membresía activa en espacio no borrado", async () => {
    const [p1, p2, p3, p4, p5, p6] = Array.from({ length: 6 }, () => randomUUID());
    const ayer = new Date(Date.now() - 86_400_000);
    const haceUnaHora = new Date(Date.now() - 3_600_000);

    try {
      await prisma.$transaction(async (tx) => {
        for (const [i, id] of [p1, p2, p3, p4, p5, p6].entries()) {
          await tx.profile.create({ data: { id: id!, displayName: `P${i + 1}` } });
        }
        const espacio = (nombre: string, por: string, borrado: Date | null = null) =>
          tx.space.create({
            data: { kind: "shared", name: nombre, createdById: por, deletedAt: borrado },
            select: { id: true },
          });
        const A = (await espacio("A", p1!)).id;
        const B = (await espacio("B", p3!)).id;
        const C = (await espacio("C borrado", p6!, haceUnaHora)).id;

        const m = (
          spaceId: string,
          profileId: string,
          role: "owner" | "collaborator",
          endedAt: Date | null = null,
        ) => tx.membership.create({ data: { spaceId, profileId, role, createdAt: ayer, endedAt } });
        await m(A, p1!, "owner");
        await m(A, p2!, "collaborator");
        await m(B, p3!, "owner");
        await m(A, p5!, "collaborator", haceUnaHora); // ya salió
        await m(C, p6!, "owner"); // espacio borrado

        expect(await rolEnEspacio(p1!, A, tx)).toBe("owner");
        expect(await rolEnEspacio(p2!, A, tx)).toBe("collaborator");
        expect(await rolEnEspacio(p3!, A, tx), "miembro de otro espacio").toBeNull();
        expect(await rolEnEspacio(p4!, A, tx), "sin membresía").toBeNull();
        expect(await rolEnEspacio(p5!, A, tx), "membresía terminada").toBeNull();
        expect(await rolEnEspacio(p6!, C, tx), "espacio borrado").toBeNull();
        expect(await rolEnEspacio(p1!, randomUUID(), tx), "espacio inexistente").toBeNull();

        expect(await tieneEspacio(p1!, tx)).toBe(true);
        expect(await tieneEspacio(p3!, tx)).toBe(true);
        expect(await tieneEspacio(p4!, tx)).toBe(false);
        expect(await tieneEspacio(p5!, tx), "membresía terminada").toBe(false);
        expect(await tieneEspacio(p6!, tx), "solo en espacio borrado").toBe(false);

        throw new Deshacer();
      });
    } catch (e) {
      if (!(e instanceof Deshacer)) throw e;
    }
  });
});
