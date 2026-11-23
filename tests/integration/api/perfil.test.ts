/* eslint-disable no-restricted-syntax --
   F4-05a: `$transaction` solo para deshacer los datos de la prueba (lanza al final y Prisma hace ROLLBACK).
   En la app, `$transaction` solo existe en `locks.ts` (ARQ-06). */
/**
 * F4-05a · La lectura de E-10 (`/me`) contra Postgres real como `moneo_app`: el perfil propio y SOLO
 * sus membresías activas en espacios no borrados; nunca las de otra persona del mismo espacio.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { crearPrisma } from "@/server/shared/db/client";
import type { PrismaClient } from "@/server/shared/db/generated/client";
import { leerPerfilConMembresias } from "@/server/shared/db/perfil";
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

describe("F4-05a perfil y membresías de /me contra Postgres real", () => {
  it("solo el perfil propio y sus membresías activas en espacios no borrados", async () => {
    const [ana, beto, carla, dani] = Array.from({ length: 4 }, () => randomUUID());
    const ayer = new Date(Date.now() - 86_400_000);
    const haceUnaHora = new Date(Date.now() - 3_600_000);

    try {
      await prisma.$transaction(async (tx) => {
        for (const [nombre, id] of [
          ["Ana", ana],
          ["Beto", beto],
          ["Carla", carla],
          ["Dani", dani],
        ] as const) {
          await tx.profile.create({ data: { id: id!, displayName: nombre } });
        }
        const espacio = (nombre: string, por: string, borrado: Date | null = null) =>
          tx.space.create({
            data: { kind: "shared", name: nombre, createdById: por, deletedAt: borrado },
            select: { id: true },
          });
        const casa = (await espacio("Casa", ana!)).id;
        const viejo = (await espacio("Viejo", carla!, haceUnaHora)).id;
        const otro = (await espacio("Otro", beto!)).id;
        const m = (
          spaceId: string,
          profileId: string,
          role: "owner" | "collaborator",
          endedAt: Date | null = null,
        ) => tx.membership.create({ data: { spaceId, profileId, role, createdAt: ayer, endedAt } });
        await m(casa, ana!, "owner");
        await m(casa, beto!, "collaborator", haceUnaHora); // Beto salió de Casa…
        await m(otro, beto!, "owner"); // …y está en Otro
        await m(viejo, carla!, "owner"); // espacio borrado

        expect(await leerPerfilConMembresias(ana!, tx)).toEqual({
          displayName: "Ana",
          membresias: [{ spaceId: casa, spaceName: "Casa", role: "owner" }],
        });
        expect(await leerPerfilConMembresias(beto!, tx)).toEqual({
          displayName: "Beto",
          membresias: [{ spaceId: otro, spaceName: "Otro", role: "owner" }],
        });
        expect((await leerPerfilConMembresias(carla!, tx))?.membresias, "espacio borrado").toEqual(
          [],
        );
        expect((await leerPerfilConMembresias(dani!, tx))?.membresias, "sin espacio").toEqual([]);
        expect(await leerPerfilConMembresias(randomUUID(), tx), "sin perfil").toBeNull();

        throw new Deshacer();
      });
    } catch (e) {
      if (!(e instanceof Deshacer)) throw e;
    }
  });
});
