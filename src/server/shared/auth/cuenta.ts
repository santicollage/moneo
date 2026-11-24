/**
 * Registro, confirmación, login y recuperación (UC-01, UC-02, DN-1, DN-2, S-7, EN-10, F4-05b).
 *
 * E-02 registro      202 SIEMPRE: permitido, no permitido (lo rechaza el hook S-7), ya registrado.
 * E-03 reenvío       202 siempre; pasado `resend:email` (3/h) no se llama a Supabase.
 * E-04 confirmación  `token_hash` del registro por POST (F4-05-D1) → cookie de sesión + perfil.
 * E-05 login         `login:ip` y `login:account` ANTES de llamar a Supabase (cuente o no el correo);
 *                    401 genérico; 403 `email_not_confirmed` solo con la contraseña correcta.
 * E-08 recuperación  202 siempre; pasado `recovery:email` (3/h) no se llama a Supabase.
 * E-09 restablecer   `token_hash` de recuperación + contraseña nueva en UNA petición (F4-05b-D4):
 *                    verifica el enlace, cambia la contraseña, cierra las demás sesiones y deja
 *                    dentro a la persona. No depende del claim `amr` (Supabase marca `otp`, no
 *                    `recovery`, cuando se verifica por `token_hash`: visto en F4-05b).
 *
 * Reglas (F4-05a): toda llamada a Supabase lleva un tope de tiempo propio (`PLAZO_AUTH_MS`); ningún
 * cliente se crea con las cookies de la petición (solo el proxy refresca, EN-11): login y
 * confirmación crean una sesión NUEVA y las cookies viejas se borran. El mensaje de Supabase nunca
 * sale ni va al log: solo su código (API10, ADR-011).
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  Confirmacion,
  Login,
  NombreVisible,
  Registro,
  Restablecimiento,
  SoloCorreo,
} from "@/contracts/auth";
import { config } from "../config";
import { asegurarPerfil } from "../db/perfil";
import { ErrorApi } from "../http/errores";
import { ipCliente } from "../http/ip";
import { validar } from "../http/validar";
import { claveCorreo, exigirIntento, registrarIntento } from "../limite";
import { logger, type Logger } from "../log";
import { cerrarSesion } from "./cerrar-sesion";
import {
  clienteConCookies,
  clienteSinSesion,
  conSenal,
  configAuth,
  type ConfigAuth,
  type CookieEscrita,
} from "./cliente-auth";
import { cookiesDeSesionNueva, parseCookieHeader } from "./cookie-sesion";

export const PLAZO_AUTH_MS = 5_000;
/** Nombre visible si el de los metadatos no sirve (solo pasa si alguien los alteró). */
export const NOMBRE_POR_DEFECTO = "Sin nombre";

export type DependenciasCuenta = {
  cfg: () => ConfigAuth;
  fetch: typeof fetch;
  plazoMs: number;
  asegurarPerfil: (profileId: string, displayName: string) => Promise<void>;
  registrarIntento: typeof registrarIntento;
  exigirIntento: typeof exigirIntento;
  ip: (peticion: Request) => string;
  log: Logger;
  /** Para cerrar las otras sesiones en E-09 (se inyecta en las pruebas). */
  cerrarOtras: (tokenAcceso: string, cliente: SupabaseClient) => Promise<void>;
};

const porDefecto: DependenciasCuenta = {
  cfg: configAuth,
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  plazoMs: PLAZO_AUTH_MS,
  asegurarPerfil: (p, n) => asegurarPerfil(p, n),
  registrarIntento,
  exigirIntento,
  ip: (p) => ipCliente(p, config().enVercel),
  log: logger,
  cerrarOtras: (t, c) => cerrarSesion(t, "others", c),
};

export type Peticion = { peticion: Request; requestId: string; leerJson: () => Promise<unknown> };

type ErrorAuth = { status?: unknown; code?: unknown; name?: unknown };

const CODIGO = /^[a-z0-9_]{1,40}$/;
const NOMBRE = /^[A-Za-z0-9_]{1,40}$/;

/** Código de error de Supabase apto para el log (nunca el mensaje). */
export function codigoAuth(err: unknown): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as ErrorAuth;
  if (typeof e.code === "string" && CODIGO.test(e.code)) return e.code;
  if (typeof e.name === "string" && NOMBRE.test(e.name)) return e.name;
  return "auth_error";
}

/** ¿Supabase respondió 4xx? (rechazo de la petición, no fallo de infraestructura). */
export function esRechazo(err: unknown): boolean {
  const e = (typeof err === "object" && err !== null ? err : {}) as ErrorAuth;
  return typeof e.status === "number" && e.status >= 400 && e.status < 500;
}

function resolver(deps: Partial<DependenciasCuenta>): DependenciasCuenta {
  return { ...porDefecto, ...deps };
}

function fetchConPlazo(d: DependenciasCuenta): typeof fetch {
  return conSenal(d.fetch, AbortSignal.timeout(d.plazoMs));
}

const aceptado = () => Response.json({ status: "check_email" }, { status: 202 });

/** 4xx de Supabase → se anota el código y la respuesta sigue siendo la genérica; 5xx o red → 500. */
function toleraRechazo(err: unknown, d: DependenciasCuenta, p: Peticion, ruta: `/api/v1${string}`) {
  if (!esRechazo(err)) throw err;
  d.log.warn("auth_rejected", { route: ruta, requestId: p.requestId, errorCode: codigoAuth(err) });
}

function nombreDe(usuario: Pick<User, "user_metadata">): string {
  const r = NombreVisible.safeParse(usuario.user_metadata?.display_name);
  return r.success ? r.data : NOMBRE_POR_DEFECTO;
}

/** Cliente que escribe una sesión NUEVA: no lee las cookies de la petición (no refresca nada). */
function clienteSesionNueva(d: DependenciasCuenta) {
  const escritas: CookieEscrita[] = [];
  let cabeceras: Record<string, string> = {};
  const cliente = clienteConCookies(
    {
      leer: () => [],
      escribir: (lista, cab) => {
        escritas.push(...lista);
        cabeceras = { ...cabeceras, ...cab };
      },
    },
    d.cfg(),
    fetchConPlazo(d),
  );
  const responder = (peticion: Request): Response => {
    const entrantes = parseCookieHeader(peticion.headers.get("cookie") ?? "");
    const headers = new Headers(cabeceras);
    for (const c of cookiesDeSesionNueva(escritas, entrantes, d.cfg().cookiesSeguras)) {
      headers.append("Set-Cookie", c);
    }
    return new Response(null, { status: 204, headers });
  };
  return { cliente, responder };
}

// ─────────────────────────────── E-02 ───────────────────────────────

export async function registrar(p: Peticion, deps: Partial<DependenciasCuenta> = {}) {
  const d = resolver(deps);
  const { email, password, displayName, invitationToken } = validar(Registro, await p.leerJson());
  // F4-05b-D3: la rama de invitación llega con F5-01 (hash, 72 h, `withInvitationLock`). Hasta
  // entonces se rechaza SIEMPRE, valga o no el token: no revela nada y no se ignora en silencio.
  if (invitationToken !== undefined) {
    throw new ErrorApi("invalid_request", {
      errors: [{ field: "invitationToken", rule: "not_available" }],
    });
  }
  const { error } = await clienteSinSesion(d.cfg(), fetchConPlazo(d)).auth.signUp({
    email,
    password,
    // El perfil NO se crea aquí (F4-05b-D2): se crea al confirmar, con este nombre.
    options: { data: { display_name: displayName } },
  });
  if (error) toleraRechazo(error, d, p, "/api/v1/auth/register");
  return aceptado();
}

// ─────────────────────────────── E-03 y E-08 ───────────────────────────────

export async function reenviarConfirmacion(p: Peticion, deps: Partial<DependenciasCuenta> = {}) {
  const d = resolver(deps);
  const { email } = validar(SoloCorreo, await p.leerJson());
  const r = await d.registrarIntento("resend:email", claveCorreo(email));
  if (!r.permitido) return aceptado(); // RNF-SEG-03: pasado el límite, 202 sin enviar nada
  const { error } = await clienteSinSesion(d.cfg(), fetchConPlazo(d)).auth.resend({
    type: "signup",
    email,
  });
  if (error) toleraRechazo(error, d, p, "/api/v1/auth/resend-confirmation");
  return aceptado();
}

export async function recuperar(p: Peticion, deps: Partial<DependenciasCuenta> = {}) {
  const d = resolver(deps);
  const { email } = validar(SoloCorreo, await p.leerJson());
  const r = await d.registrarIntento("recovery:email", claveCorreo(email));
  if (!r.permitido) return aceptado();
  // El enlace lo arma la plantilla (`{{ .SiteURL }}/restablecer#token_hash=…&type=recovery`).
  const { error } = await clienteSinSesion(d.cfg(), fetchConPlazo(d)).auth.resetPasswordForEmail(
    email,
  );
  if (error) toleraRechazo(error, d, p, "/api/v1/auth/recover");
  return aceptado();
}

// ─────────────────────────────── E-04 ───────────────────────────────

export async function confirmar(p: Peticion, deps: Partial<DependenciasCuenta> = {}) {
  const d = resolver(deps);
  const { tokenHash, type } = validar(Confirmacion, await p.leerJson());
  const { cliente, responder } = clienteSesionNueva(d);
  const { data, error } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    if (esRechazo(error)) throw new ErrorApi("link_invalid");
    throw error;
  }
  if (!data.user || !data.session) throw new ErrorApi("link_invalid");
  // Si esto falla, la cookie NO sale (la respuesta no se arma): la persona puede entrar con E-05,
  // que vuelve a intentar crear el perfil.
  await d.asegurarPerfil(data.user.id, nombreDe(data.user));
  return responder(p.peticion);
}

// ─────────────────────────────── E-05 ───────────────────────────────

export async function entrar(p: Peticion, deps: Partial<DependenciasCuenta> = {}) {
  const d = resolver(deps);
  const { email, password } = validar(Login, await p.leerJson());
  // DN-2: se cuenta ANTES de probar la contraseña, exista o no el correo.
  await d.exigirIntento("login:ip", d.ip(p.peticion));
  await d.exigirIntento("login:account", claveCorreo(email));
  const { cliente, responder } = clienteSesionNueva(d);
  const { data, error } = await cliente.auth.signInWithPassword({ email, password });
  if (error) {
    if (codigoAuth(error) === "email_not_confirmed") throw new ErrorApi("email_not_confirmed");
    if (esRechazo(error)) throw new ErrorApi("invalid_credentials");
    throw error;
  }
  await d.asegurarPerfil(data.user.id, nombreDe(data.user));
  return responder(p.peticion);
}

// ─────────────────────────────── E-09 ───────────────────────────────

/**
 * F4-05b-D4. Orden, y por qué:
 *   1. Se valida la contraseña nueva (DN-1) ANTES de tocar el token: un error de formato no gasta
 *      el enlace.
 *   2. `verifyOtp` con `type: recovery` gasta el token y da una sesión nueva (aún no sale la cookie).
 *   3. `PUT /auth/v1/user` con el token de esa sesión, sin cargarla en un cliente que pudiera
 *      refrescarla (EN-11). Si Supabase la rechaza aquí (p. ej. la misma contraseña de antes), el
 *      enlace ya se gastó: 400 con la regla y hay que pedir otro correo (costo aceptado).
 *   4. Cierra las OTRAS sesiones (`scope: others`): un teléfono perdido queda afuera. Si falla → 500,
 *      sin cookie: no se promete lo que no se hizo (como E-07, F4-05a-D2).
 *   5. Crea el perfil si falta y responde 204 con la cookie de la sesión nueva.
 */
export async function restablecer(p: Peticion, deps: Partial<DependenciasCuenta> = {}) {
  const d = resolver(deps);
  const { tokenHash, password } = validar(Restablecimiento, await p.leerJson());
  const { cliente, responder } = clienteSesionNueva(d);
  const { data, error } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  if (error) {
    if (esRechazo(error)) throw new ErrorApi("link_invalid");
    throw error;
  }
  if (!data.user || !data.session) throw new ErrorApi("link_invalid");
  const token = data.session.access_token;

  const cfg = d.cfg();
  const r = await fetchConPlazo(d)(`${cfg.url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: cfg.clavePublica,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const cuerpo = (await r.json().catch(() => ({}))) as { error_code?: unknown; code?: unknown };
    const codigo = codigoAuth({ code: cuerpo.error_code ?? cuerpo.code });
    if (codigo === "same_password" || codigo === "weak_password") {
      throw new ErrorApi("invalid_request", { errors: [{ field: "password", rule: codigo }] });
    }
    throw Object.assign(new Error("password_update_failed"), {
      name: "PasswordUpdateFailed",
      code: codigo,
    });
  }
  await d.cerrarOtras(token, clienteSinSesion(cfg, fetchConPlazo(d)));
  await d.asegurarPerfil(data.user.id, nombreDe(data.user));
  return responder(p.peticion);
}
