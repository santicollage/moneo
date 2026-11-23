// F4-05a · EN-11, R54: el proxy refresca solo con ≤ 60 s, una vez, y deja cookies HttpOnly con solo tokens.
import { describe, expect, it } from "vitest";
import { claims, cookiesDeSesion, firmar, llaves } from "../../../../tests/autorizacion/jwt";
import {
  CONFIG_AUTH,
  errorGotrue,
  gotrueFalso,
  sesionNueva,
  type Llamada,
} from "../../../../tests/autorizacion/gotrue";
import { clienteConCookies, conSenal } from "./cliente-auth";
import { leerTokens } from "./cookie-sesion";
import { debeRefrescar, MARGEN_REFRESCO_S, refrescarSiHaceFalta } from "./refresco";

const ahoraS = () => Math.floor(Date.now() / 1000);

async function escenario(
  quedanS: number,
  responder?: (l: Llamada) => Response | Promise<Response>,
) {
  const ll = await llaves();
  const t = ahoraS();
  const viejo = await firmar(ll.privada, claims(t, { exp: t + quedanS }));
  const nuevo = await firmar(ll.privada, claims(t, { exp: t + 3600 }));
  const g = gotrueFalso(responder ?? (() => sesionNueva(nuevo, "refresco-2", t)));
  const cookies = cookiesDeSesion({
    access_token: viejo,
    refresh_token: "refresco-1",
    expires_at: t + quedanS,
    expires_in: quedanS,
    token_type: "bearer",
  });
  const r = await refrescarSiHaceFalta(cookies, {
    crearCliente: (f, senal) => clienteConCookies(f, CONFIG_AUTH, conSenal(g.fetch, senal)),
    plazoMs: 300,
  });
  return { r, g, nuevo };
}

describe("F4-05a debeRefrescar", () => {
  it.each([
    [61, false],
    [60, true],
    [1, true],
    [0, true],
    [-86_400, true],
  ])("quedan %i s → %s", async (quedan, esperado) => {
    const ll = await llaves();
    const t = 1_800_000_000;
    expect(debeRefrescar(await firmar(ll.privada, claims(t, { exp: t + quedan })), t)).toBe(
      esperado,
    );
    expect(MARGEN_REFRESCO_S).toBe(60);
  });

  it("token ilegible o sin exp → no refresca (el verificador decidirá)", async () => {
    expect(debeRefrescar("a.b.c", 0)).toBe(false);
    const ll = await llaves();
    expect(debeRefrescar(await firmar(ll.privada, { sub: "x" }), 0)).toBe(false);
  });
});

describe("F4-05a refrescarSiHaceFalta", () => {
  it("con más de 60 s: no llama a Supabase", async () => {
    const { r, g } = await escenario(61);
    expect(r).toEqual({ estado: "no_aplica" });
    expect(g.llamadas).toHaveLength(0);
  });

  it("sin cookie o sin token de refresco: no llama a Supabase", async () => {
    const g = gotrueFalso(() => new Response(null, { status: 500 }));
    const crearCliente = (f: Parameters<typeof clienteConCookies>[0]) =>
      clienteConCookies(f, CONFIG_AUTH, g.fetch);
    expect(await refrescarSiHaceFalta([], { crearCliente })).toEqual({ estado: "no_aplica" });
    const ll = await llaves();
    const sinRefresco = cookiesDeSesion({
      access_token: await firmar(ll.privada, claims(ahoraS(), { exp: 0 })),
    });
    expect(await refrescarSiHaceFalta(sinRefresco, { crearCliente })).toEqual({
      estado: "no_aplica",
    });
    expect(g.llamadas).toHaveLength(0);
  });

  it.each([60, 1, -86_400])(
    "con %i s: refresca UNA vez con el token de refresco y deja cookies HttpOnly solo con tokens",
    async (quedan) => {
      const { r, g, nuevo } = await escenario(quedan);
      expect(r.estado).toBe("refrescada");
      expect(g.llamadas).toHaveLength(1);
      const [l] = g.llamadas;
      expect(l!.metodo).toBe("POST");
      expect(l!.url.pathname).toBe("/auth/v1/token");
      expect(l!.url.searchParams.get("grant_type")).toBe("refresh_token");
      expect(l!.cuerpo).toEqual({ refresh_token: "refresco-1" });

      if (r.estado !== "refrescada") return;
      const vivas = r.cookies.filter((c) => c.value !== "");
      expect(vivas.length).toBeGreaterThan(0);
      for (const c of vivas) {
        expect(c.name).toMatch(/^moneo-sesion(\.\d+)?$/);
        expect(c.options).toMatchObject({
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
        });
      }
      const tokens = await leerTokens(vivas);
      expect(tokens).toEqual({ tokenAcceso: nuevo, tokenRefresco: "refresco-2" });
      // tokens-only: ni el correo ni el usuario viajan en la cookie (RNF-PRI-03).
      const texto = vivas
        .map((c) => Buffer.from(c.value.replace(/^base64-/, ""), "base64url").toString())
        .join("");
      expect(texto).not.toContain("ana@moneo.test");
      expect(r.cabeceras["Cache-Control"] ?? r.cabeceras["cache-control"] ?? "").toMatch(
        /no-store|private/,
      );
    },
  );

  it("token de refresco rechazado y acceso YA vencido → sesión cerrada (cookies borradas)", async () => {
    const { r } = await escenario(-10, () => errorGotrue(400, "refresh_token_not_found"));
    expect(r.estado).toBe("cerrada");
    if (r.estado !== "cerrada") return;
    expect(r.cookies.length).toBeGreaterThan(0);
    expect(r.cookies.every((c) => c.value === "" && c.options.maxAge === 0)).toBe(true);
  });

  it("token de refresco rechazado y acceso aún vigente → la cookie se conserva (sirve hasta su exp)", async () => {
    const { r } = await escenario(30, () => errorGotrue(400, "refresh_token_not_found"));
    expect(r.estado).toBe("fallo");
  });

  it("Supabase no responde → fallo en ≤ el plazo, sin cookies y sin seguir reintentando", async () => {
    const inicio = Date.now();
    const { r, g } = await escenario(30, () => Promise.reject(new TypeError("fetch failed")));
    expect(r).toEqual({ estado: "fallo", errorCode: "refresh_timeout" });
    expect(Date.now() - inicio).toBeLessThan(2_000);
    const hechas = g.llamadas.length;
    await new Promise((ok) => setTimeout(ok, 1_000));
    // Tras el corte, los reintentos de auth-js fallan sin llegar a la red.
    expect(g.llamadas.length).toBe(hechas);
  });
});
