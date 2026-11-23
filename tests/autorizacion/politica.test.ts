// F4-04b · T-3/T-4: cada perfil de acceso × los 5 sujetos, contra `withPolicy` real con dobles.
// «Hecho cuando»: hay test de 401 sin token.
import { describe, expect, it, vi } from "vitest";
import {
  PERFILES,
  RUTAS,
  SUJETOS,
  type DefinicionRuta,
  type IdRuta,
  type Perfil,
} from "../../src/contracts/shared/routes";
import { aplicarPolitica, decidir, withPolicy } from "../../src/server/shared/auth/politica";
import { verificadorActivo } from "../../src/server/shared/auth/sesion";
import { manejar } from "../../src/server/shared/http/manejar";
import { CUERPO_404 } from "../../src/server/shared/http/problem";
import { AHORA_S, depsDe, depsManejar, ESPACIO, esperado } from "./falsos";

const metodo = (p: Perfil) =>
  p === "public" || p === "member" || p === "session" ? "GET" : "POST";

async function llamar(perfil: Perfil, sujeto: (typeof SUJETOS)[number], spaceId: string = ESPACIO) {
  const { deps, llamadas } = depsDe(sujeto);
  const cuerpo = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
  const h = manejar(
    { ruta: "/api/v1/prueba", metodo: metodo(perfil) },
    aplicarPolitica(perfil, cuerpo, deps),
    depsManejar,
  );
  const m = metodo(perfil);
  const res = await h(
    new Request("https://app.test/api/v1/prueba", {
      method: m,
      headers: m === "GET" ? {} : { origin: "https://app.test" },
    }),
    { params: Promise.resolve({ spaceId }) },
  );
  return { res, cuerpo, llamadas };
}

describe.each(PERFILES)("perfil %s", (perfil) => {
  it.each(SUJETOS)("sujeto %s", async (sujeto) => {
    const esp = esperado(perfil, sujeto);
    const { res, cuerpo } = await llamar(perfil, sujeto);
    if (esp === "ok") {
      expect(res.status).toBe(200);
      expect(cuerpo).toHaveBeenCalledTimes(1);
    } else {
      expect(res.status).toBe(esp);
      expect(cuerpo, "el manejador no debe correr si se deniega").not.toHaveBeenCalled();
    }
  });
});

describe("401 sin token", () => {
  it.each(PERFILES.filter((p) => p !== "public"))(
    "%s → 401 unauthenticated, sin tocar la base",
    async (perfil) => {
      const { res, llamadas } = await llamar(perfil, "An");
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect((await res.json()).code).toBe("unauthenticated");
      expect(llamadas.rol + llamadas.espacio).toBe(0);
    },
  );

  it("F4-05a: el verificador de la app, sin cookie, da null sin leer la configuración ni la red", async () => {
    // En esta prueba no hay variables de entorno: si el verificador leyera la configuración, lanzaría.
    expect(await verificadorActivo()(new Request("https://app.test/x"))).toBeNull();
  });
});

describe("404 uniforme (S-5, A-8)", () => {
  it("no-miembro, espacio inexistente y UUID mal formado dan el mismo cuerpo byte a byte", async () => {
    const otro = await llamar("member", "Ot", ESPACIO);
    const inexistente = await llamar("member", "Pr", "33333333-3333-4333-8333-333333333333");
    const malo = await llamar("member", "Pr", "no-es-uuid");
    for (const { res } of [otro, inexistente, malo]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(CUERPO_404);
    }
  });

  it("un UUID mal formado no consulta la base", async () => {
    expect((await llamar("owner", "Pr", "x")).llamadas.rol).toBe(0);
  });

  it("colaborador en ruta owner es 403 (sí es miembro: no hay nada que ocultar)", async () => {
    expect((await llamar("owner", "Co")).res.status).toBe(403);
  });
});

describe("recovery_session (EN-10, T-12)", () => {
  const hechos = (amr: { method: string; timestamp: number }[]) => ({
    sesion: { profileId: "p", amr, correo: "p@moneo.test" },
    rol: null,
    tieneEspacio: false,
    ahoraS: AHORA_S,
  });
  it("recovery de hace 14 min pasa; de hace 16 min, no", () => {
    expect(
      decidir("recovery_session", hechos([{ method: "recovery", timestamp: AHORA_S - 840 }])),
    ).toBe("ok");
    expect(
      decidir("recovery_session", hechos([{ method: "recovery", timestamp: AHORA_S - 960 }])),
    ).toBe("forbidden");
  });
  it("otro método (password, otp) no sirve aunque sea reciente", () => {
    expect(decidir("recovery_session", hechos([{ method: "password", timestamp: AHORA_S }]))).toBe(
      "forbidden",
    );
  });
  it("timestamp en el futuro lejano o NaN no pasa", () => {
    expect(
      decidir("recovery_session", hechos([{ method: "recovery", timestamp: AHORA_S + 3600 }])),
    ).toBe("forbidden");
    expect(
      decidir("recovery_session", hechos([{ method: "recovery", timestamp: Number.NaN }])),
    ).toBe("forbidden");
  });
  it("de punta a punta: con amr reciente el manejador corre", async () => {
    const { deps } = depsDe("SE", [{ method: "recovery", timestamp: AHORA_S - 60 }]);
    const h = manejar(
      { ruta: "/api/v1/prueba", metodo: "POST" },
      aplicarPolitica("recovery_session", () => Promise.resolve(Response.json({})), deps),
      depsManejar,
    );
    const res = await h(
      new Request("https://app.test/api/v1/prueba", {
        method: "POST",
        headers: { origin: "https://app.test" },
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("actor", () => {
  it("el spaceId sale de la ruta, y el rol de la membresía", async () => {
    const { deps } = depsDe("Co");
    let visto: unknown;
    const h = manejar(
      { ruta: "/api/v1/prueba", metodo: "GET" },
      aplicarPolitica(
        "member",
        (ctx) => {
          visto = ctx.actor;
          return Promise.resolve(Response.json({}));
        },
        deps,
      ),
      depsManejar,
    );
    await h(new Request("https://app.test/api/v1/prueba"), {
      params: Promise.resolve({ spaceId: ESPACIO.toUpperCase() }),
    });
    expect(visto).toMatchObject({ spaceId: ESPACIO, rol: "collaborator" });
  });
});

const TODAS: readonly DefinicionRuta[] = Object.values(RUTAS);

describe("rutas reales del registro", () => {
  it.each(TODAS)("$id ($method $path) cumple su perfil con los 5 sujetos", async (def) => {
    for (const sujeto of SUJETOS) {
      const { deps } = depsDe(sujeto);
      const h = manejar(
        { ruta: def.path, metodo: def.method },
        withPolicy(def.id as IdRuta, () => Promise.resolve(Response.json({})), deps),
        depsManejar,
      );
      const origin: Record<string, string> =
        def.method === "GET" ? {} : { origin: "https://app.test" };
      const res = await h(
        new Request(`https://app.test${def.path}`, { method: def.method, headers: origin }),
        {
          params: Promise.resolve({ ...(def.example.params ?? {}) }),
        },
      );
      const esp = esperado(def.access, sujeto);
      expect(res.status === 200 ? "ok" : res.status, `${def.id} ${sujeto}`).toBe(esp);
    }
  });
});
