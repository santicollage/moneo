/**
 * Registro de rutas (ADR-007, `12-diseno-api.md` §1.9, T-3, F4-04b).
 *
 * Es la ÚNICA fuente de verdad de qué endpoints existen y quién puede llamarlos. De aquí salen:
 *   1. `withPolicy(id, …)` de cada `route.ts` (perfil de acceso y acción),
 *   2. la prueba que falla si un `route.ts` no está aquí o no usa `withPolicy` (D-14),
 *   3. las pruebas de autorización generadas: cada ruta × 5 sujetos (`tests/autorizacion/`),
 *   4. `openapi.json` (F4-04c).
 * Una ruta nueva se agrega aquí PRIMERO; sin `access` no compila.
 *
 * Perfiles de acceso (T-3, T-12, EN-10): el resultado de cada sujeto sale del perfil.
 *
 *   perfil            An   SE   Pr   Co   Ot
 *   public            ok   ok   ok   ok   ok
 *   session           401  ok   ok   ok   ok
 *   recovery_session  401  403* 403* 403* 403*   (* con sesión normal; ok con `amr: recovery` de ≤ 15 min)
 *   no_space          401  ok   409  409  409
 *   member            401  404  ok   ok   404
 *   owner             401  404  ok   403  404
 *   invitation_token  401  ok   ok   ok   ok      (el resto lo decide el manejador con el token: E-16, E-17)
 *
 * «ok» = pasó la autorización (T-4): el manejador puede responder aún 409 o 422 por reglas de negocio.
 * Si una ruta necesita otra cosa, se crea un perfil nuevo (con su ADR), no una excepción por ruta.
 */
import { z } from "zod";

export const PERFILES = [
  "public",
  "session",
  "recovery_session",
  "no_space",
  "member",
  "owner",
  "invitation_token",
] as const;
export type Perfil = (typeof PERFILES)[number];

/** An sin sesión · SE con sesión y sin espacio · Pr propietario · Co colaborador · Ot miembro de otro espacio. */
export const SUJETOS = ["An", "SE", "Pr", "Co", "Ot"] as const;
export type Sujeto = (typeof SUJETOS)[number];

/** `"ok"` = pasó la autorización; un número es el rechazo exacto (401, 403, 404, 409 `already_in_space`). */
export type Resultado = "ok" | 401 | 403 | 404 | 409;

/** Resultado esperado de cada perfil para cada sujeto (T-3). `recovery_session` asume sesión normal sin `amr`. */
export const MATRIZ: Readonly<Record<Perfil, Readonly<Record<Sujeto, Resultado>>>> = {
  public: { An: "ok", SE: "ok", Pr: "ok", Co: "ok", Ot: "ok" },
  session: { An: 401, SE: "ok", Pr: "ok", Co: "ok", Ot: "ok" },
  recovery_session: { An: 401, SE: 403, Pr: 403, Co: 403, Ot: 403 },
  no_space: { An: 401, SE: "ok", Pr: 409, Co: 409, Ot: 409 },
  member: { An: 401, SE: 404, Pr: "ok", Co: "ok", Ot: 404 },
  owner: { An: 401, SE: 404, Pr: "ok", Co: 403, Ot: 404 },
  invitation_token: { An: 401, SE: "ok", Pr: "ok", Co: "ok", Ot: "ok" },
};

export type MetodoRuta = "GET" | "POST" | "PATCH" | "PUT";

export type DefinicionRuta = {
  /** `E-01` … `E-46` de `12-diseno-api.md`. Igual a su clave en `RUTAS`. */
  readonly id: string;
  readonly method: MetodoRuta;
  /** Patrón con parámetros `:nombre`. Toda ruta `member` u `owner` lleva `:spaceId`. */
  readonly path: `/api/v1${string}`;
  /** Acción de la matriz de `seguridad.md` §5 (con EN-1). */
  readonly action: string;
  readonly access: Perfil;
  /** Entrada de ejemplo: la usan las pruebas generadas y `openapi.json`. */
  readonly example: {
    readonly params?: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
    readonly body?: unknown;
  };
  /** Códigos de error propios de la ruta (§1.6), además de los de la política y los de infraestructura. */
  readonly errors: readonly string[];
  /** Esquema de salida por estado (F4-04c los usa para OpenAPI). `null` = sin cuerpo (204). */
  readonly output: Readonly<Record<number, z.ZodType | null>>;
};

export const RUTAS = {
  "E-01": {
    id: "E-01",
    method: "GET",
    path: "/api/v1/health",
    action: "system.health",
    access: "public",
    example: {},
    errors: ["unavailable"],
    output: { 200: z.strictObject({ status: z.literal("ok") }) },
  },
  "E-06": {
    id: "E-06",
    method: "POST",
    path: "/api/v1/auth/logout",
    action: "auth.logout",
    access: "session",
    example: {},
    errors: [],
    output: { 204: null },
  },
  "E-07": {
    id: "E-07",
    method: "POST",
    path: "/api/v1/auth/logout-all",
    action: "auth.logout_all",
    access: "session",
    example: {},
    errors: [],
    output: { 204: null },
  },
  "E-10": {
    id: "E-10",
    method: "GET",
    path: "/api/v1/me",
    action: "me.read",
    access: "session",
    example: {},
    errors: [],
    output: {
      200: z.strictObject({
        profile: z.strictObject({ id: z.uuid(), displayName: z.string(), email: z.string() }),
        memberships: z.array(
          z.strictObject({
            spaceId: z.uuid(),
            spaceName: z.string(),
            role: z.enum(["owner", "collaborator"]),
          }),
        ),
      }),
    },
  },
} as const satisfies Record<string, DefinicionRuta>;

export type IdRuta = keyof typeof RUTAS;
