// F4-05a · E-10: forma de `/me`, correo desde la sesión, perfil inexistente visible (500), no 401.
import { describe, expect, it } from "vitest";
import { RUTAS } from "@/contracts/shared/routes";
import { leerMe, PerfilInexistente } from "./me";

const actor = { profileId: "0f8fad5b-d9cb-469f-a165-70867728950e", spaceId: null, rol: null };

describe("F4-05a leerMe (E-10)", () => {
  it("sin espacio: memberships vacío; cumple el esquema de salida del registro", async () => {
    const me = await leerMe(actor, "ana@moneo.test", () =>
      Promise.resolve({ displayName: "Ana", membresias: [] }),
    );
    expect(me).toEqual({
      profile: { id: actor.profileId, displayName: "Ana", email: "ana@moneo.test" },
      memberships: [],
    });
    expect(RUTAS["E-10"].output[200].safeParse(me).success).toBe(true);
  });

  it("con espacio: lo devuelve tal cual y cumple el esquema", async () => {
    const membresias = [
      {
        spaceId: "11111111-1111-4111-8111-111111111111",
        spaceName: "Casa",
        role: "owner" as const,
      },
    ];
    const me = await leerMe(actor, "ana@moneo.test", () =>
      Promise.resolve({ displayName: "Ana", membresias }),
    );
    expect(me.memberships).toEqual(membresias);
    expect(RUTAS["E-10"].output[200].safeParse(me).success).toBe(true);
  });

  it("sesión válida sin perfil → PerfilInexistente (500 y Sentry), nunca 401", async () => {
    await expect(
      leerMe(actor, "ana@moneo.test", () => Promise.resolve(null)),
    ).rejects.toBeInstanceOf(PerfilInexistente);
  });
});
