/**
 * F4-05b · «Hecho cuando»: N+1 logins dan una 429 con `Retry-After`, también con un correo que NO
 * existe (DN-2, M-14). E-05 de verdad (`entrar` dentro de `manejar()`), con el contador en Postgres
 * real como `moneo_app` y un Supabase Auth falso que siempre dice «credenciales incorrectas»: el
 * límite no depende de que el correo exista, porque se cuenta ANTES de preguntarle a Supabase.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { entrar, type DependenciasCuenta } from "@/server/shared/auth/cuenta";
import { crearPrisma } from "@/server/shared/db/client";
import { incrementarIntento } from "@/server/shared/db/intentos";
import type { PrismaClient } from "@/server/shared/db/generated/client";
import { manejar } from "@/server/shared/http/manejar";
import { claveCorreo, exigirIntento, hashClave, type Ambito } from "@/server/shared/limite";
import { crearLogger } from "@/server/shared/log";
import { CONFIG_AUTH, errorGotrue, gotrueFalso } from "../../autorizacion/gotrue";

const URL_APP = process.env.TEST_APP_DATABASE_URL;
const URL_DUENO = process.env.TEST_OWNER_DATABASE_URL;
if (!URL_APP || !URL_DUENO)
  throw new Error("Faltan TEST_APP_DATABASE_URL o TEST_OWNER_DATABASE_URL.");

const LLAVE = "llave-de-prueba-de-32-caracteres-o-mas";
const ORIGEN = "http://localhost:3000";
const FRASE = ["no", "es", "la", "contrasena", "correcta"].join("-");

const prisma: PrismaClient = crearPrisma(
  { url: URL_APP, local: true, ca: undefined },
  crearLogger(() => {}),
);
const dueno = new pg.Pool({ connectionString: URL_DUENO, max: 2 });
const usadas: Buffer[] = [];
afterAll(async () => {
  await dueno.query("DELETE FROM rate_limit_counter WHERE key_hash = ANY($1::bytea[])", [usadas]);
  await Promise.all([prisma.$disconnect(), dueno.end()]);
});

function login(ip: string) {
  const g = gotrueFalso(() => errorGotrue(400, "invalid_credentials"));
  const deps: Partial<DependenciasCuenta> = {
    cfg: () => CONFIG_AUTH,
    fetch: g.fetch,
    ip: () => ip,
    log: crearLogger(() => {}),
    exigirIntento: (ambito: Ambito, clave: string) => {
      usadas.push(Buffer.from(hashClave(ambito, clave, LLAVE)));
      return exigirIntento(ambito, clave, {
        llave: () => LLAVE,
        incrementar: (s, h, i) => incrementarIntento(s, h, i, prisma),
      });
    },
    asegurarPerfil: () => Promise.reject(new Error("no debería llegar aquí")),
  };
  const h = manejar({ ruta: "/api/v1/auth/login", metodo: "POST" }, (ctx) => entrar(ctx, deps), {
    appOrigin: () => ORIGEN,
    log: crearLogger(() => {}),
  });
  const pedir = (email: string) =>
    h(
      new Request(`${ORIGEN}/api/v1/auth/login`, {
        method: "POST",
        headers: { origin: ORIGEN, "content-type": "application/json" },
        body: JSON.stringify({ email, password: FRASE }),
      }),
    );
  return { pedir, g };
}

describe("F4-05b E-05 límite de intentos (DN-2)", () => {
  it("login:account — 5 + 1 con un correo que no existe → la 6.ª es 429 y no llega a Supabase", async () => {
    const { pedir, g } = login(randomUUID());
    const correo = `no-existe-${randomUUID()}@moneo.test`;
    const estados: number[] = [];
    // El mismo correo escrito distinto cuenta igual (claveCorreo).
    for (const e of [correo, correo.toUpperCase(), ` ${correo}`, correo, correo, correo]) {
      estados.push((await pedir(e)).status);
    }
    expect(estados).toEqual([401, 401, 401, 401, 401, 429]);
    expect(g.llamadas).toHaveLength(5);
    const ultima = await pedir(correo);
    expect(ultima.status).toBe(429);
    expect(Number(ultima.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await ultima.json()).code).toBe("too_many_attempts");
    expect(claveCorreo(` ${correo.toUpperCase()}`)).toBe(correo);
  });

  it("login:ip — 20 + 1 desde la misma IP con correos distintos → la 21.ª es 429", async () => {
    const { pedir, g } = login(randomUUID());
    const estados: number[] = [];
    for (let i = 0; i < 21; i++)
      estados.push((await pedir(`otro-${randomUUID()}@moneo.test`)).status);
    expect(estados.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(estados[20]).toBe(429);
    expect(g.llamadas).toHaveLength(20);
  });

  it("el 401 es genérico: no dice si el correo existe", async () => {
    const { pedir } = login(randomUUID());
    const r = await pedir(`no-existe-${randomUUID()}@moneo.test`);
    const cuerpo = (await r.json()) as Record<string, unknown>;
    expect(cuerpo.code).toBe("invalid_credentials");
    expect(JSON.stringify(cuerpo)).not.toContain("MARCADOR");
  });
});
