// F4-05a · E-06 y E-07 (EN-9): alcance correcto, token del usuario, cookies borradas, errores de E-07 no se tragan.
import { describe, expect, it } from "vitest";
import {
  cabeceraCookie,
  claims,
  cookiesDeSesion,
  firmar,
  llaves,
} from "../../../../tests/autorizacion/jwt";
import { CONFIG_AUTH, errorGotrue, gotrueFalso } from "../../../../tests/autorizacion/gotrue";
import { cerrarSesionDePeticion, type Alcance } from "./cerrar-sesion";
import { clienteSinSesion } from "./cliente-auth";

async function cerrar(alcance: Alcance, responder: () => Response, tamanoTrozo?: number) {
  const ll = await llaves();
  const t = Math.floor(Date.now() / 1000);
  const acceso = await firmar(ll.privada, claims(t));
  const cookies = cookiesDeSesion(
    { access_token: acceso, refresh_token: "refresco-1" },
    tamanoTrozo,
  );
  const g = gotrueFalso(responder);
  const peticion = new Request("https://app.test/api/v1/auth/logout", {
    method: "POST",
    headers: { cookie: `otra=1; ${cabeceraCookie(cookies)}` },
  });
  const res = await cerrarSesionDePeticion(peticion, alcance, {
    cliente: () => clienteSinSesion(CONFIG_AUTH, g.fetch),
    cookiesSeguras: () => true,
  });
  return { res, g, acceso, cookies };
}

describe("F4-05a cerrar sesión", () => {
  it.each<[Alcance, string]>([
    ["local", "E-06"],
    ["global", "E-07"],
  ])("scope=%s (%s): llama a /logout con el token del usuario y responde 204", async (alcance) => {
    const { res, g, acceso } = await cerrar(alcance, () => new Response(null, { status: 204 }));
    expect(res.status).toBe(204);
    expect(g.llamadas).toHaveLength(1);
    const [l] = g.llamadas;
    expect(l!.metodo).toBe("POST");
    expect(l!.url.pathname).toBe("/auth/v1/logout");
    expect(l!.url.searchParams.get("scope")).toBe(alcance);
    expect(l!.cabeceras.get("authorization")).toBe(`Bearer ${acceso}`);
  });

  it("borra la cookie y TODOS sus trozos, con las mismas opciones y Max-Age=0; no toca otras cookies", async () => {
    const { res, cookies } = await cerrar("local", () => new Response(null, { status: 204 }), 200);
    expect(cookies.length).toBeGreaterThan(2);
    const borradas = res.headers.getSetCookie();
    const nombres = borradas.map((c) => c.split("=")[0]);
    for (const c of cookies) expect(nombres).toContain(c.name);
    expect(nombres).not.toContain("otra");
    for (const c of borradas) {
      expect(c).toMatch(/Max-Age=0/);
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/Secure/i);
      expect(c).toMatch(/Path=\//);
    }
  });

  it.each([401, 403, 404])(
    "E-06 con Supabase %i (sesión ya cerrada allá) → 204 igual",
    async (estado) => {
      const { res } = await cerrar("local", () => errorGotrue(estado, "session_not_found"));
      expect(res.status).toBe(204);
    },
  );

  it.each([401, 500, 503])(
    "E-07 con Supabase %i → lanza (500): no promete cerrar las otras sesiones",
    async (estado) => {
      await expect(cerrar("global", () => errorGotrue(estado, "x"))).rejects.toBeDefined();
    },
  );

  it("E-06 con Supabase 500 → lanza", async () => {
    await expect(cerrar("local", () => errorGotrue(500, "x"))).rejects.toBeDefined();
  });
});
