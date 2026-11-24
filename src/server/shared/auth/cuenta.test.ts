// F4-05b · E-02, E-03, E-04, E-05, E-08 y E-09 contra un Supabase Auth falso (HTTP real de supabase-js).
import { describe, expect, it, vi } from "vitest";
import {
  claims,
  cookiesDeSesion,
  firmar,
  llaves,
  PERFIL,
} from "../../../../tests/autorizacion/jwt";
import {
  CONFIG_AUTH,
  errorGotrue,
  gotrueFalso,
  type Llamada,
} from "../../../../tests/autorizacion/gotrue";
import { ErrorApi } from "../http/errores";
import type { Logger } from "../log";
import {
  confirmar,
  entrar,
  NOMBRE_POR_DEFECTO,
  recuperar,
  reenviarConfirmacion,
  registrar,
  restablecer,
  type DependenciasCuenta,
} from "./cuenta";

const ORIGEN = "http://localhost:3000";
// Valores en constantes con nombre neutro (gitleaks, regla 2 de F4-04c).
const FRASE = ["una", "frase", "de", "prueba", "larga"].join("-");
const OTRA_FRASE = ["otra", "frase", "de", "prueba", "larga"].join("-");
const CORREO = "ana@moneo.test";

function logFalso() {
  const avisos: { evento: string; campos: unknown }[] = [];
  const log: Logger = {
    info: () => {},
    error: () => {},
    warn: (evento, campos) => avisos.push({ evento, campos }),
  };
  return { log, avisos };
}

type Arreglo = {
  responder: (l: Llamada) => Response | Promise<Response>;
  permitido?: boolean;
  exigir?: (ambito: string, clave: string) => Promise<void>;
  perfil?: (id: string, nombre: string) => Promise<void>;
  cerrarOtras?: DependenciasCuenta["cerrarOtras"];
};

function arreglo(a: Arreglo) {
  const g = gotrueFalso(a.responder);
  const { log, avisos } = logFalso();
  const intentos: string[] = [];
  const perfiles: [string, string][] = [];
  const deps: Partial<DependenciasCuenta> = {
    cfg: () => CONFIG_AUTH,
    fetch: g.fetch,
    plazoMs: 2_000,
    log,
    ip: () => "203.0.113.7",
    registrarIntento: (ambito) => {
      intentos.push(ambito);
      return Promise.resolve({ permitido: a.permitido ?? true, intento: 1, reintentoSegundos: 60 });
    },
    exigirIntento: async (ambito, clave) => {
      intentos.push(`${ambito}=${clave}`);
      await a.exigir?.(ambito, clave);
    },
    asegurarPerfil: async (id, nombre) => {
      perfiles.push([id, nombre]);
      await a.perfil?.(id, nombre);
    },
    cerrarOtras: a.cerrarOtras ?? (() => Promise.resolve()),
  };
  return { deps, g, avisos, intentos, perfiles };
}

function peticion(cuerpo: unknown, cookie?: string) {
  const peticion = new Request(`${ORIGEN}/api/v1/auth/x`, {
    method: "POST",
    headers: { origin: ORIGEN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(cuerpo),
  });
  return {
    peticion,
    requestId: "4f1c2a9e-8b7d-4c3a-9e2f-1a2b3c4d5e6f",
    leerJson: () => peticion.json(),
  };
}

async function sesion(nombre?: unknown) {
  const ll = await llaves();
  const ahora = Math.floor(Date.now() / 1000);
  return Response.json({
    access_token: await firmar(ll.privada, claims(ahora)),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: ahora + 3600,
    refresh_token: "refresco-nuevo",
    user: {
      id: PERFIL,
      aud: "authenticated",
      role: "authenticated",
      email: CORREO,
      app_metadata: { provider: "email" },
      user_metadata: nombre === undefined ? {} : { display_name: nombre },
      created_at: "2026-01-01T00:00:00Z",
    },
  });
}

const usuarioSinSesion = () =>
  Response.json({ id: PERFIL, aud: "authenticated", role: "", email: CORREO, user_metadata: {} });

async function errorDe(p: Promise<unknown>): Promise<ErrorApi> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorApi) return e;
    throw e;
  }
  throw new Error("no lanzó");
}

const setCookies = (r: Response) => r.headers.getSetCookie();

describe("E-02 registro (S-7, UC-01 A1/A2, F4-05b-D2/D3)", () => {
  it("202 y el nombre va en los metadatos; NO crea perfil", async () => {
    const a = arreglo({ responder: usuarioSinSesion });
    const r = await registrar(
      peticion({ email: " Ana@Moneo.test ", password: FRASE, displayName: " Ana " }),
      a.deps,
    );
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ status: "check_email" });
    expect(a.g.llamadas).toHaveLength(1);
    expect(a.g.llamadas[0]!.url.pathname).toBe("/auth/v1/signup");
    expect(a.g.llamadas[0]!.cuerpo).toMatchObject({ email: CORREO, data: { display_name: "Ana" } });
    expect(a.perfiles).toEqual([]);
  });

  it("correo no permitido (el hook responde 403): 202 igual, y se anota solo el código", async () => {
    const a = arreglo({ responder: () => errorGotrue(403, "signup_not_allowed") });
    const r = await registrar(
      peticion({ email: CORREO, password: FRASE, displayName: "Ana" }),
      a.deps,
    );
    expect(r.status).toBe(202);
    expect(a.avisos).toHaveLength(1);
    expect(a.avisos[0]!.evento).toBe("auth_rejected");
    expect(JSON.stringify(a.avisos)).not.toContain("MARCADOR"); // el mensaje de Supabase no sale
    expect(JSON.stringify(a.avisos)).not.toContain(CORREO);
  });

  it("Supabase caído (5xx): no se finge éxito", async () => {
    const a = arreglo({ responder: () => errorGotrue(500, "unexpected_failure") });
    await expect(
      registrar(peticion({ email: CORREO, password: FRASE, displayName: "Ana" }), a.deps),
    ).rejects.not.toBeInstanceOf(ErrorApi);
  });

  it("invitationToken: 400 siempre hasta F5-01, sin llamar a Supabase", async () => {
    const a = arreglo({ responder: usuarioSinSesion });
    const e = await errorDe(
      registrar(
        peticion({ email: CORREO, password: FRASE, displayName: "Ana", invitationToken: "t" }),
        a.deps,
      ),
    );
    expect(e.codigo).toBe("invalid_request");
    expect(e.extensiones?.errors).toEqual([{ field: "invitationToken", rule: "not_available" }]);
    expect(a.g.llamadas).toEqual([]);
  });

  it("DN-1: contraseña de 14 caracteres → 400 sin llamar a Supabase", async () => {
    const a = arreglo({ responder: usuarioSinSesion });
    const e = await errorDe(
      registrar(peticion({ email: CORREO, password: "a".repeat(14), displayName: "Ana" }), a.deps),
    );
    expect(e.codigo).toBe("invalid_request");
    expect(a.g.llamadas).toEqual([]);
  });
});

describe("E-03 y E-08: 202 siempre, con límite por correo (RNF-SEG-03)", () => {
  it.each([
    ["E-03", reenviarConfirmacion, "resend:email", "/auth/v1/resend"],
    ["E-08", recuperar, "recovery:email", "/auth/v1/recover"],
  ] as const)("%s llama a Supabase dentro del límite", async (_id, fn, ambito, ruta) => {
    const a = arreglo({ responder: () => Response.json({}) });
    const r = await fn(peticion({ email: CORREO }), a.deps);
    expect(r.status).toBe(202);
    expect(a.intentos).toEqual([ambito]);
    expect(a.g.llamadas.map((l) => l.url.pathname)).toEqual([ruta]);
  });

  it.each([
    ["E-03", reenviarConfirmacion],
    ["E-08", recuperar],
  ] as const)("%s pasado el límite: 202 y NO envía correo", async (_id, fn) => {
    const a = arreglo({ responder: () => Response.json({}), permitido: false });
    const r = await fn(peticion({ email: CORREO }), a.deps);
    expect(r.status).toBe(202);
    expect(a.g.llamadas).toEqual([]);
  });

  it("E-08 con un 4xx de Supabase (p. ej. su propio límite) responde 202 igual", async () => {
    const a = arreglo({ responder: () => errorGotrue(429, "over_email_send_rate_limit") });
    expect((await recuperar(peticion({ email: CORREO }), a.deps)).status).toBe(202);
  });
});

describe("E-04 confirmación con token_hash por POST (F4-05-D1)", () => {
  it("verifica, crea el perfil con el nombre de los metadatos y fija la cookie", async () => {
    const a = arreglo({ responder: () => sesion("Ana") });
    const r = await confirmar(peticion({ tokenHash: "abc123", type: "email" }), a.deps);
    expect(r.status).toBe(204);
    expect(a.g.llamadas[0]!.url.pathname).toBe("/auth/v1/verify");
    expect(a.g.llamadas[0]!.cuerpo).toMatchObject({ token_hash: "abc123", type: "email" });
    expect(a.perfiles).toEqual([[PERFIL, "Ana"]]);
    const c = setCookies(r);
    expect(c.some((x) => x.startsWith("moneo-sesion") && /HttpOnly/i.test(x))).toBe(true);
  });

  it("borra los trozos de una sesión vieja que la nueva no reemplaza", async () => {
    const a = arreglo({ responder: () => sesion("Ana") });
    const viejas = cookiesDeSesion({ access_token: "x".repeat(5000), refresh_token: "r" }, 3000);
    expect(viejas.map((c) => c.name)).toContain("moneo-sesion.1");
    const cab = viejas.map((c) => `${c.name}=${c.value}`).join("; ");
    const r = await confirmar(peticion({ tokenHash: "abc123", type: "email" }, cab), a.deps);
    const c = setCookies(r);
    const borradas = c.filter((x) => /Max-Age=0/i.test(x)).map((x) => x.split("=")[0]);
    const escritas = c.filter((x) => !/Max-Age=0/i.test(x)).map((x) => x.split("=")[0]);
    for (const v of viejas.map((x) => x.name)) {
      expect(escritas.includes(v) || borradas.includes(v), `${v} quedaría viva`).toBe(true);
    }
  });

  it("nombre alterado en los metadatos → nombre por defecto", async () => {
    const a = arreglo({ responder: () => sesion("x".repeat(61)) });
    await confirmar(peticion({ tokenHash: "abc123", type: "email" }), a.deps);
    expect(a.perfiles).toEqual([[PERFIL, NOMBRE_POR_DEFECTO]]);
  });

  it("enlace vencido o usado (4xx) → 400 link_invalid, sin perfil ni cookie", async () => {
    const a = arreglo({ responder: () => errorGotrue(403, "otp_expired") });
    const e = await errorDe(confirmar(peticion({ tokenHash: "abc123", type: "email" }), a.deps));
    expect(e.codigo).toBe("link_invalid");
    expect(a.perfiles).toEqual([]);
  });

  it("si crear el perfil falla, no hay respuesta con cookie (se propaga el error)", async () => {
    const a = arreglo({
      responder: () => sesion("Ana"),
      perfil: () => Promise.reject(new Error("db")),
    });
    await expect(
      confirmar(peticion({ tokenHash: "abc123", type: "email" }), a.deps),
    ).rejects.toThrow("db");
  });

  it("un enlace de recuperación no abre sesión por E-04 (F4-05b-D4) → 400", async () => {
    const a = arreglo({ responder: () => sesion("Ana") });
    const e = await errorDe(confirmar(peticion({ tokenHash: "abc123", type: "recovery" }), a.deps));
    expect(e.codigo).toBe("invalid_request");
    expect(a.g.llamadas).toEqual([]);
  });

  it("tokenHash con caracteres raros → 400 sin llamar a Supabase", async () => {
    const a = arreglo({ responder: () => sesion("Ana") });
    const e = await errorDe(confirmar(peticion({ tokenHash: "a b<", type: "email" }), a.deps));
    expect(e.codigo).toBe("invalid_request");
    expect(a.g.llamadas).toEqual([]);
  });
});

describe("E-05 login (DN-2, M-14)", () => {
  it("cuenta IP y cuenta ANTES de llamar a Supabase, con el correo normalizado", async () => {
    const orden: string[] = [];
    const a = arreglo({
      responder: (l) => {
        orden.push(l.url.pathname);
        return sesion("Ana");
      },
      exigir: (ambito) => {
        orden.push(ambito);
        return Promise.resolve();
      },
    });
    const r = await entrar(peticion({ email: " ANA@moneo.test", password: FRASE }), a.deps);
    expect(r.status).toBe(204);
    expect(orden).toEqual(["login:ip", "login:account", "/auth/v1/token"]);
    expect(a.intentos).toEqual(["login:ip=203.0.113.7", `login:account=${CORREO}`]);
    expect(a.perfiles).toEqual([[PERFIL, "Ana"]]);
    expect(setCookies(r).some((x) => x.startsWith("moneo-sesion"))).toBe(true);
  });

  it("pasado el límite: 429 y NO se prueba la contraseña", async () => {
    const a = arreglo({
      responder: () => sesion("Ana"),
      exigir: (ambito) =>
        ambito === "login:account"
          ? Promise.reject(new ErrorApi("too_many_attempts", undefined, 120))
          : Promise.resolve(),
    });
    const e = await errorDe(entrar(peticion({ email: CORREO, password: FRASE }), a.deps));
    expect(e.codigo).toBe("too_many_attempts");
    expect(e.reintentoSegundos).toBe(120);
    expect(a.g.llamadas).toEqual([]);
  });

  it("credenciales incorrectas → 401 invalid_credentials, sin perfil", async () => {
    const a = arreglo({ responder: () => errorGotrue(400, "invalid_credentials") });
    const e = await errorDe(entrar(peticion({ email: CORREO, password: OTRA_FRASE }), a.deps));
    expect(e.codigo).toBe("invalid_credentials");
    expect(a.perfiles).toEqual([]);
  });

  it("correo sin confirmar → 403 email_not_confirmed", async () => {
    const a = arreglo({ responder: () => errorGotrue(400, "email_not_confirmed") });
    const e = await errorDe(entrar(peticion({ email: CORREO, password: FRASE }), a.deps));
    expect(e.codigo).toBe("email_not_confirmed");
  });

  it("Supabase caído → error inesperado (500), no 401", async () => {
    const a = arreglo({ responder: () => errorGotrue(503, "unexpected_failure") });
    await expect(
      entrar(peticion({ email: CORREO, password: FRASE }), a.deps),
    ).rejects.not.toBeInstanceOf(ErrorApi);
  });

  it("repara un perfil que falte: asegurarPerfil corre en cada login", async () => {
    const a = arreglo({ responder: () => sesion("Ana") });
    await entrar(peticion({ email: CORREO, password: FRASE }), a.deps);
    await entrar(peticion({ email: CORREO, password: FRASE }), a.deps);
    expect(a.perfiles).toHaveLength(2);
  });
});

describe("E-09 restablecer con token_hash + contraseña (F4-05b-D4)", () => {
  /** Supabase falso: /verify da una sesión; /user responde según `usuario`. */
  const supa = (usuario: () => Response) => async (l: Llamada) =>
    l.url.pathname === "/auth/v1/verify" ? sesion("Rita") : usuario();

  it("verifica el enlace, cambia la contraseña con ESE token, cierra las otras y deja la cookie", async () => {
    const cerrar = vi.fn<DependenciasCuenta["cerrarOtras"]>(() => Promise.resolve());
    const a = arreglo({
      responder: supa(() => Response.json({ id: PERFIL })),
      cerrarOtras: cerrar,
    });
    const r = await restablecer(peticion({ tokenHash: "abc123", password: OTRA_FRASE }), a.deps);
    expect(r.status).toBe(204);
    const [verify, user] = a.g.llamadas;
    expect(verify!.cuerpo).toMatchObject({ token_hash: "abc123", type: "recovery" });
    expect(user!.metodo).toBe("PUT");
    expect(user!.url.pathname).toBe("/auth/v1/user");
    expect(user!.cuerpo).toEqual({ password: OTRA_FRASE });
    const token = user!.cabeceras.get("authorization")!.replace("Bearer ", "");
    expect(cerrar).toHaveBeenCalledWith(token, expect.anything());
    expect(a.perfiles).toEqual([[PERFIL, "Rita"]]);
    expect(setCookies(r).some((x) => x.startsWith("moneo-sesion"))).toBe(true);
  });

  it("DN-1 se valida ANTES de gastar el enlace: 14 caracteres → 400 sin llamar a Supabase", async () => {
    const a = arreglo({ responder: supa(() => Response.json({})) });
    const e = await errorDe(
      restablecer(peticion({ tokenHash: "abc123", password: "a".repeat(14) }), a.deps),
    );
    expect(e.codigo).toBe("invalid_request");
    expect(a.g.llamadas).toEqual([]);
  });

  it("enlace vencido o usado → 400 link_invalid, sin cambiar nada", async () => {
    const a = arreglo({ responder: () => errorGotrue(403, "otp_expired") });
    const e = await errorDe(
      restablecer(peticion({ tokenHash: "abc123", password: OTRA_FRASE }), a.deps),
    );
    expect(e.codigo).toBe("link_invalid");
    expect(a.g.llamadas.map((l) => l.url.pathname)).toEqual(["/auth/v1/verify"]);
  });

  it("misma contraseña → 400 con la regla, sin cerrar sesiones ni cookie", async () => {
    const cerrar = vi.fn<DependenciasCuenta["cerrarOtras"]>(() => Promise.resolve());
    const a = arreglo({
      responder: supa(() => errorGotrue(422, "same_password")),
      cerrarOtras: cerrar,
    });
    const e = await errorDe(
      restablecer(peticion({ tokenHash: "abc123", password: OTRA_FRASE }), a.deps),
    );
    expect(e.extensiones?.errors).toEqual([{ field: "password", rule: "same_password" }]);
    expect(cerrar).not.toHaveBeenCalled();
  });

  it("si cerrar las otras sesiones falla → se propaga (500), no 204", async () => {
    const a = arreglo({
      responder: supa(() => Response.json({ id: PERFIL })),
      cerrarOtras: () => Promise.reject(new Error("logout")),
    });
    await expect(
      restablecer(peticion({ tokenHash: "abc123", password: OTRA_FRASE }), a.deps),
    ).rejects.toThrow("logout");
  });
});
