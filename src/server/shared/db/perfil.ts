/**
 * Lectura de identidad para E-10 (`/me`, F4-05a).
 *
 * Vive aquí, junto a `membresias.ts` y por la misma razón (F4-04b-D2): no son datos de un espacio,
 * sino «quién es esta persona y en qué espacios está». Los `*.repo.ts` exigen `(tx, spaceId, …)`.
 * Solo devuelve las membresías ACTIVAS del propio perfil en espacios no borrados (`seguridad.md`
 * §7: `/me` es la única fuente del `spaceId` para la interfaz).
 */
import { db } from "./client";
import type { PrismaClient } from "./generated/client";
import type { Rol } from "./membresias";

export type LectorPerfil = Pick<PrismaClient, "profile">;

export type PerfilConMembresias = {
  displayName: string;
  membresias: { spaceId: string; spaceName: string; role: Rol }[];
};

export async function leerPerfilConMembresias(
  profileId: string,
  lector: LectorPerfil = db(),
): Promise<PerfilConMembresias | null> {
  const fila = await lector.profile.findUnique({
    where: { id: profileId },
    select: {
      displayName: true,
      memberships: {
        where: { endedAt: null, space: { deletedAt: null } },
        select: { role: true, space: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!fila) return null;
  return {
    displayName: fila.displayName,
    membresias: fila.memberships.map((m) => ({
      spaceId: m.space.id,
      spaceName: m.space.name,
      role: m.role,
    })),
  };
}
