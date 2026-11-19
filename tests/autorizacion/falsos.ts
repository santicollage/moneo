// Dobles de prueba de la sesión y de las membresías (T-5). Nada de red ni de base de datos.
import {
  MATRIZ,
  type Perfil,
  type Resultado,
  type Sujeto,
} from "../../src/contracts/shared/routes";
import type { DependenciasPolitica } from "../../src/server/shared/auth/politica";
import type { Sesion } from "../../src/server/shared/auth/sesion";
import type { Dependencias } from "../../src/server/shared/http/manejar";

export const ESPACIO = "11111111-1111-4111-8111-111111111111";
export const OTRO_ESPACIO = "22222222-2222-4222-8222-222222222222";
export const AHORA_S = 1_800_000_000;

export const SESIONES: Record<Exclude<Sujeto, "An">, Sesion> = {
  SE: { profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", amr: [] },
  Pr: { profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", amr: [] },
  Co: { profileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", amr: [] },
  Ot: { profileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", amr: [] },
};

/** Membresías del mundo falso: Pr y Co en ESPACIO; Ot en OTRO_ESPACIO; SE en ninguno. */
const ROLES: Record<string, Record<string, "owner" | "collaborator">> = {
  [SESIONES.Pr.profileId]: { [ESPACIO]: "owner" },
  [SESIONES.Co.profileId]: { [ESPACIO]: "collaborator" },
  [SESIONES.Ot.profileId]: { [OTRO_ESPACIO]: "owner" },
};

export type Llamadas = { verificador: number; rol: number; espacio: number };

export function depsDe(
  sujeto: Sujeto,
  amr: Sesion["amr"] = [],
): {
  deps: DependenciasPolitica;
  llamadas: Llamadas;
} {
  const llamadas: Llamadas = { verificador: 0, rol: 0, espacio: 0 };
  const sesion = sujeto === "An" ? null : { ...SESIONES[sujeto], amr };
  return {
    llamadas,
    deps: {
      verificador: () => () => {
        llamadas.verificador++;
        return Promise.resolve(sesion);
      },
      rolEnEspacio: (p, s) => {
        llamadas.rol++;
        return Promise.resolve(ROLES[p]?.[s] ?? null);
      },
      tieneEspacio: (p) => {
        llamadas.espacio++;
        return Promise.resolve(ROLES[p] !== undefined);
      },
      ahoraS: () => AHORA_S,
    },
  };
}

export const depsManejar: Partial<Dependencias> = {
  appOrigin: () => "https://app.test",
  log: { info() {}, warn() {}, error() {} },
  ahora: () => 0,
  nuevoId: () => "00000000-0000-4000-8000-000000000000",
};

export const esperado = (perfil: Perfil, sujeto: Sujeto): Resultado => MATRIZ[perfil][sujeto];
