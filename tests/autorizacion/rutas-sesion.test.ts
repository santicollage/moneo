// F4-05a · Los route.ts de E-06 y E-07 de verdad (manejar + withPolicy + alcance de EN-9).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fijarVerificador } from "../../src/server/shared/auth/sesion";
import { cabeceraCookie, claims, cookiesDeSesion, firmar, llaves } from "./jwt";
import { CONFIG_AUTH, gotrueFalso } from "./gotrue";

const ORIGEN = "http://localhost:3000";
// El valor va en una constante: `KEY` seguido de un texto entre comillas lo marca gitleaks (F4-04c).
const LLAVE = "llave-de-prueba-de-32-caracteres-o-mas";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://moneo_app:x@127.0.0.1:54322/postgres");
  vi.stubEnv("APP_ORIGIN", ORIGEN);
  vi.stubEnv("RATE_LIMIT_HASH_KEY", LLAVE);
  vi.stubEnv("SUPABASE_URL", CONFIG_AUTH.url);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", CONFIG_AUTH.clavePublica);
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fijarVerificador(undefined);
});

async function llamar(ruta: "logout" | "logout-all", conSesion: boolean) {
  const ll = await llaves();
  const cookies = cookiesDeSesion({
    access_token: await firmar(ll.privada, claims(Math.floor(Date.now() / 1000))),
    refresh_token: "refresco-1",
  });
  const g = gotrueFalso(() => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", g.fetch);
  fijarVerificador(() =>
    Promise.resolve(
      conSesion
        ? { profileId: "0f8fad5b-d9cb-469f-a165-70867728950e", amr: [], correo: "a@moneo.test" }
        : null,
    ),
  );
  const mod =
    ruta === "logout"
      ? await import("../../src/app/api/v1/auth/logout/route")
      : await import("../../src/app/api/v1/auth/logout-all/route");
  const res = await mod.POST(
    new Request(`${ORIGEN}/api/v1/auth/${ruta}`, {
      method: "POST",
      headers: { origin: ORIGEN, cookie: cabeceraCookie(cookies) },
    }),
  );
  return { res, g };
}

describe("F4-05a E-06 / E-07 por su route.ts", () => {
  it("E-06 → scope=local", async () => {
    const { res, g } = await llamar("logout", true);
    expect(res.status).toBe(204);
    expect(g.llamadas.map((l) => l.url.searchParams.get("scope"))).toEqual(["local"]);
  });

  it("E-07 → scope=global", async () => {
    const { res, g } = await llamar("logout-all", true);
    expect(res.status).toBe(204);
    expect(g.llamadas.map((l) => l.url.searchParams.get("scope"))).toEqual(["global"]);
  });

  it.each(["logout", "logout-all"] as const)(
    "%s sin sesión → 401 sin llamar a Supabase",
    async (r) => {
      const { res, g } = await llamar(r, false);
      expect(res.status).toBe(401);
      expect(g.llamadas).toHaveLength(0);
    },
  );
});
