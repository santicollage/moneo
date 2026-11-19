/**
 * Lecturas de membresía para `withPolicy` (F4-04b, ADR-013, M-4).
 *
 * Viven aquí y no en un `*.repo.ts` porque no son datos de un espacio: responden «¿qué es esta
 * persona respecto de este espacio?». Los repositorios (`*.repo.ts`) exigen `(tx, spaceId, …)` y
 * ninguna excepción. Una membresía cuenta solo si está activa (`ended_at IS NULL`) y su espacio no
 * está borrado: la misma condición de la sentencia de bloqueo de M-4, que la revalida bajo el
 * `FOR UPDATE` antes de escribir.
 */
import { db } from "./client";
import type { PrismaClient } from "./generated/client";

export type Rol = "owner" | "collaborator";

/** Lo mínimo del cliente que se usa; permite probar con un cliente propio. */
export type LectorMembresias = Pick<PrismaClient, "membership">;

/** Rol activo de `profileId` en `spaceId`, o `null` si no es miembro (o el espacio no existe o está borrado). */
export async function rolEnEspacio(
  profileId: string,
  spaceId: string,
  lector: LectorMembresias = db(),
): Promise<Rol | null> {
  const fila = await lector.membership.findFirst({
    where: { spaceId, profileId, endedAt: null, space: { deletedAt: null } },
    select: { role: true },
  });
  return fila?.role ?? null;
}

/** ¿Tiene `profileId` alguna membresía activa, en cualquier espacio? (S6: máximo una en v1). */
export async function tieneEspacio(
  profileId: string,
  lector: LectorMembresias = db(),
): Promise<boolean> {
  const fila = await lector.membership.findFirst({
    where: { profileId, endedAt: null, space: { deletedAt: null } },
    select: { id: true },
  });
  return fila !== null;
}
