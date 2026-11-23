// F4-05a · EN-11: el proxy refresca y copia las cookies a la petición y a la respuesta; si no
// hace falta, no llama a Supabase. El matcher incluye /api/v1 y excluye estáticos.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { claims, cookiesDeSesion, firmar, llaves, cabeceraCookie } from "../tests/autorizacion/jwt";
import { CONFIG_AUTH, gotrueFalso, sesionNueva } from "../tests/autorizacion/gotrue";
import { config, crearProxy } from "./proxy";
import { clienteConCookies, conSenal } from "./server/shared/auth/cliente-auth";

async function peticionCon(quedanS: number) {
  const ll = await llaves();
  const t = Math.floor(Date.now() / 1000);
  const viejo = await firmar(ll.privada, claims(t, { exp: t + quedanS }));
  const nuevo = await firmar(ll.privada, claims(t, { exp: t + 3600 }));
  const g = gotrueFalso(() => sesionNueva(nuevo, "refresco-2", t));
  const cookies = cookiesDeSesion({
    access_token: viejo,
    refresh_token: "refresco-1",
    expires_at: t + quedanS,
  });
  const req = new NextRequest("https://app.test/api/v1/me", {
    headers: { cookie: cabeceraCookie(cookies) },
  });
  const proxy = crearProxy({
    crearCliente: (f, s) => clienteConCookies(f, CONFIG_AUTH, conSenal(g.fetch, s)),
  });
  return { res: await proxy(req), g, nuevo };
}

describe("F4-05a proxy (EN-11)", () => {
  it("token con tiempo de sobra: deja pasar sin llamar a Supabase ni escribir cookies", async () => {
    const { res, g } = await peticionCon(3000);
    expect(g.llamadas).toHaveLength(0);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("token por vencer: refresca, Set-Cookie HttpOnly al navegador y cookie nueva a la petición", async () => {
    const { res, g } = await peticionCon(30);
    expect(g.llamadas).toHaveLength(1);
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.length).toBeGreaterThan(0);
    for (const c of setCookie.filter((x) => x.startsWith("moneo-sesion"))) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/Secure/i);
      expect(c).toMatch(/SameSite=Lax/i);
      expect(c).toMatch(/Path=\//);
    }
    // La petición que sigue (Route Handler o página) ve el token nuevo, no el viejo.
    const haciaAdentro = res.headers.get("x-middleware-request-cookie") ?? "";
    const nuevaCookie = setCookie.find((c) => c.startsWith("moneo-sesion="))!.split(";")[0]!;
    expect(haciaAdentro).toContain(nuevaCookie);
  });

  it("sin cookie de sesión: deja pasar", async () => {
    const proxy = crearProxy({
      crearCliente: () => {
        throw new Error("no debería crear cliente");
      },
    });
    const res = await proxy(new NextRequest("https://app.test/plan"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("F4-05a matcher del proxy", () => {
  it.each([
    ["/api/v1/me", true],
    ["/api/v1/auth/logout", true],
    ["/", true],
    ["/plan", true],
    ["/_next/static/chunks/a.js", false],
    ["/_next/image?url=x", false],
    ["/favicon.ico", false],
    ["/manifest.webmanifest", false],
    ["/sw.js", false],
    ["/icons/icono-192.png", false],
    ["/logo.svg", false],
  ])("%s → %s", (url, esperado) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(esperado);
  });
});
