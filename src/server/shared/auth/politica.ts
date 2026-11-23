/**
 * `withPolicy` (F4-04b, ADR-013, D-14, T-2 paso 4, T-3, T-12).
 *
 * Todo Route Handler de `/api/v1` pasa por aquí: obtiene la sesión, resuelve la membresía del
 * `spaceId` de la RUTA (nunca del cuerpo ni de la query) y decide con `decidir`, una función pura
 * que implementa los perfiles del registro (`src/contracts/shared/routes.ts`). Si no autoriza,
 * el manejador no corre: no lee el cuerpo ni toca la base de datos de negocio.
 *
 * - Sin sesión → 401. Sin membresía activa en el espacio, espacio inexistente o `spaceId` mal
 *   formado → 404 con el cuerpo fijo (S-5, A-8): no se distingue «no existe» de «no es tuyo».
 * - Colaborador en ruta `owner` → 403. Con sesión que ya tiene espacio en `no_space` → 409.
 * - `recovery_session` exige `amr` con `recovery` de ≤ 15 min (EN-10); si no, 403.
 */
import { RUTAS, type IdRuta, type Perfil } from "@/contracts/shared/routes";
import { rolEnEspacio, tieneEspacio, type Rol } from "../db/membresias";
import { ErrorApi } from "../http/errores";
import type { Contexto, Manejador } from "../http/manejar";
import { verificadorActivo, type Sesion, type VerificadorSesion } from "./sesion";

export const VENTANA_RECUPERACION_S = 15 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Quién actúa. Los servicios de `src/server` lo reciben explícito; nunca un `Request` (D-14). */
export type Actor = {
  readonly profileId: string;
  readonly spaceId: string | null;
  readonly rol: Rol | null;
};

export type ContextoPolitica = Omit<Contexto, "params"> & {
  readonly actor: Actor;
  /** La sesión verificada (`null` solo en rutas `public`). No se pasa a los servicios: ellos reciben `actor`. */
  readonly sesion: Sesion | null;
  readonly params: Readonly<Record<string, string>>;
};

export type ManejadorPolitica = (ctx: ContextoPolitica) => Promise<Response>;

export type Hechos = {
  readonly sesion: Sesion | null;
  /** Rol en el espacio de la ruta; `null` si no es miembro activo. Solo se mira en `member` y `owner`. */
  readonly rol: Rol | null;
  /** ¿Tiene ya algún espacio? Solo se mira en `no_space`. */
  readonly tieneEspacio: boolean;
  /** Segundos Unix. */
  readonly ahoraS: number;
};

export type Veredicto = "ok" | "unauthenticated" | "forbidden" | "not_found" | "already_in_space";

export function recuperacionReciente(sesion: Sesion, ahoraS: number): boolean {
  return sesion.amr.some(
    (e) =>
      e.method === "recovery" &&
      Number.isFinite(e.timestamp) &&
      e.timestamp <= ahoraS + 60 &&
      ahoraS - e.timestamp <= VENTANA_RECUPERACION_S,
  );
}

/** Pura: el veredicto de cada perfil. Es la matriz T-3 hecha código. */
export function decidir(perfil: Perfil, h: Hechos): Veredicto {
  if (perfil === "public") return "ok";
  if (h.sesion === null) return "unauthenticated";
  switch (perfil) {
    case "session":
    case "invitation_token":
      return "ok";
    case "recovery_session":
      return recuperacionReciente(h.sesion, h.ahoraS) ? "ok" : "forbidden";
    case "no_space":
      return h.tieneEspacio ? "already_in_space" : "ok";
    case "member":
      return h.rol === null ? "not_found" : "ok";
    case "owner":
      return h.rol === null ? "not_found" : h.rol === "owner" ? "ok" : "forbidden";
  }
}

export type DependenciasPolitica = {
  verificador: () => VerificadorSesion;
  rolEnEspacio: (profileId: string, spaceId: string) => Promise<Rol | null>;
  tieneEspacio: (profileId: string) => Promise<boolean>;
  ahoraS: () => number;
};

const porDefecto: DependenciasPolitica = {
  verificador: verificadorActivo,
  rolEnEspacio: (p, s) => rolEnEspacio(p, s),
  tieneEspacio: (p) => tieneEspacio(p),
  ahoraS: () => Math.floor(Date.now() / 1000),
};

/** Rutas de Next: `withPolicy("E-xx", …)` toma el perfil del registro. */
export function withPolicy(
  id: IdRuta,
  fn: ManejadorPolitica,
  deps: Partial<DependenciasPolitica> = {},
): Manejador {
  return aplicarPolitica(RUTAS[id].access, fn, deps);
}

/** Núcleo de `withPolicy`, por perfil. Separado para probar los 7 perfiles sin depender del registro. */
export function aplicarPolitica(
  perfil: Perfil,
  fn: ManejadorPolitica,
  deps: Partial<DependenciasPolitica> = {},
): Manejador {
  const d: DependenciasPolitica = { ...porDefecto, ...deps };
  const conEspacio = perfil === "member" || perfil === "owner";

  return async (ctx) => {
    const sesion = perfil === "public" ? null : await d.verificador()(ctx.peticion);
    let spaceId: string | null = null;
    let rol: Rol | null = null;
    let espacioOcupado = false;

    if (sesion !== null) {
      if (conEspacio) {
        const crudo = ctx.params.spaceId;
        if (crudo === undefined || !UUID.test(crudo)) throw new ErrorApi("not_found");
        spaceId = crudo.toLowerCase();
        rol = await d.rolEnEspacio(sesion.profileId, spaceId);
      } else if (perfil === "no_space") {
        espacioOcupado = await d.tieneEspacio(sesion.profileId);
      }
    }

    const veredicto = decidir(perfil, {
      sesion,
      rol,
      tieneEspacio: espacioOcupado,
      ahoraS: d.ahoraS(),
    });
    if (veredicto !== "ok") throw new ErrorApi(veredicto);

    const actor: Actor = { profileId: sesion?.profileId ?? "", spaceId, rol };
    return fn({ ...ctx, actor, sesion });
  };
}
