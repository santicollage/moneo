/**
 * E-10 `GET /me` (UC-02, `12-diseno-api.md` §2.1, F4-05a).
 *
 * Devuelve el perfil de quien llama y SOLO sus membresías activas (0 o 1 en v1). El correo sale
 * del claim `email` de la sesión: `profile` no lo guarda (RNF-PRI-03, M-2).
 *
 * Una sesión válida sin perfil es un estado roto (el perfil se crea al confirmar el correo y se
 * repara al entrar, M-2 con F4-05b-D2): se lanza `PerfilInexistente` → 500 y Sentry, para que se
 * vea. Un 401 haría que la persona entrara y saliera en bucle sin que nadie se enterara.
 */
import type { Actor } from "../shared/auth/politica";
import { leerPerfilConMembresias, type PerfilConMembresias } from "../shared/db/perfil";

export class PerfilInexistente extends Error {
  constructor() {
    super("perfil_inexistente");
    this.name = "PerfilInexistente";
  }
}

export type Me = {
  profile: { id: string; displayName: string; email: string };
  memberships: PerfilConMembresias["membresias"];
};

export async function leerMe(
  actor: Actor,
  correo: string,
  leer: (profileId: string) => Promise<PerfilConMembresias | null> = (p) =>
    leerPerfilConMembresias(p),
): Promise<Me> {
  const perfil = await leer(actor.profileId);
  if (!perfil) throw new PerfilInexistente();
  return {
    profile: { id: actor.profileId, displayName: perfil.displayName, email: correo },
    memberships: perfil.membresias,
  };
}
