/**
 * F4-04c · «Hecho cuando»: N+1 peticiones dan 429, con el incremento atómico probado en paralelo
 * (EN-13, RNF-SEG-02) contra Postgres real como `moneo_app`.
 *
 * Las peticiones pasan por `manejar()` como cualquier Route Handler; el manejador de prueba hace lo
 * mismo que hará el login de F4-05 antes de mirar la contraseña: `exigirIntento`. Cada prueba usa
 * una clave al azar: no se pisan entre sí ni con corridas anteriores.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { crearPrisma } from "@/server/shared/db/client";
import { incrementarIntento } from "@/server/shared/db/intentos";
import type { PrismaClient } from "@/server/shared/db/generated/client";
import { manejar } from "@/server/shared/http/manejar";
import { exigirIntento, hashClave, LIMITES, type Ambito } from "@/server/shared/limite";
import { crearLogger } from "@/server/shared/log";

const URL_APP = process.env.TEST_APP_DATABASE_URL;
const URL_DUENO = process.env.TEST_OWNER_DATABASE_URL;
if (!URL_APP || !URL_DUENO)
  throw new Error(
    "Faltan TEST_APP_DATABASE_URL o TEST_OWNER_DATABASE_URL (README, «Pruebas de la base»).",
  );
for (const u of [URL_APP, URL_DUENO]) {
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(u).hostname)) {
    throw new Error("Estas pruebas solo corren contra un Postgres local.");
  }
}

const LLAVE = "llave-de-prueba-de-32-caracteres-o-mas";
const ORIGEN = "http://localhost:3000";

// Pool de 10: más conexiones que el pool de la app (5) para que el paralelo sea real en la base.
const prisma: PrismaClient = crearPrisma(
  { url: URL_APP, local: true, ca: undefined },
  crearLogger(() => {}),
  { max: 10 },
);
const dueno = new pg.Pool({ connectionString: URL_DUENO, max: 2 });

// Estas pruebas SÍ escriben (el paralelo necesita confirmar cada sentencia): se anotan las claves y
// al final se borran como dueño, para no tocar las demás pruebas que leen `rate_limit_counter`.
const usadas: Buffer[] = [];
const anotar = (ambito: Ambito, clave: string) => {
  usadas.push(Buffer.from(hashClave(ambito, clave, LLAVE)));
  return clave;
};
afterAll(async () => {
  await dueno.query("DELETE FROM rate_limit_counter WHERE key_hash = ANY($1::bytea[])", [usadas]);
  await Promise.all([prisma.$disconnect(), dueno.end()]);
});

function ruta(ambito: Ambito, clave: string, ahora: () => number = () => Date.now()) {
  anotar(ambito, clave);
  return manejar(
    { ruta: "/api/v1/auth/login", metodo: "POST" },
    async () => {
      await exigirIntento(ambito, clave, {
        llave: () => LLAVE,
        ahora,
        incrementar: (s, h, i) => incrementarIntento(s, h, i, prisma),
      });
      return new Response(null, { status: 204 });
    },
    { appOrigin: () => ORIGEN, log: crearLogger(() => {}) },
  );
}

const peticion = () =>
  new Request(`${ORIGEN}/api/v1/auth/login`, { method: "POST", headers: { origin: ORIGEN } });

async function fila(ambito: Ambito, clave: string) {
  const r = await dueno.query<{ count: number; n: string }>(
    "SELECT max(count) AS count, count(*) AS n FROM rate_limit_counter WHERE scope = $1 AND key_hash = $2",
    [ambito, Buffer.from(hashClave(ambito, clave, LLAVE))],
  );
  return { count: r.rows[0]?.count, filas: Number(r.rows[0]?.n) };
}

describe("F4-04c límite de intentos contra Postgres real (EN-13)", () => {
  it.each([
    ["login:account", 5],
    ["login:ip", 20],
    ["invite:accept", 10],
  ] as const)("%s: %i + 1 peticiones en paralelo → exactamente una 429", async (ambito, n) => {
    expect(LIMITES[ambito].maximo).toBe(n);
    const clave = randomUUID();
    const h = ruta(ambito, clave);
    const respuestas = await Promise.all(Array.from({ length: n + 1 }, () => h(peticion())));
    const estados = respuestas.map((r) => r.status).sort();
    expect(estados.filter((s) => s === 204)).toHaveLength(n);
    expect(estados.filter((s) => s === 429)).toHaveLength(1);

    const r429 = respuestas.find((r) => r.status === 429)!;
    expect(r429.headers.get("content-type")).toBe("application/problem+json");
    const retry = Number(r429.headers.get("retry-after"));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(LIMITES[ambito].ventanaSegundos);
    expect(await r429.json()).toMatchObject({ status: 429, code: "too_many_attempts" });

    // Una sola fila con count = N + 1: ningún incremento se perdió ni se duplicó.
    expect(await fila(ambito, clave)).toEqual({ count: n + 1, filas: 1 });
  });

  it("sin lectura-y-escritura: 50 incrementos simultáneos devuelven 1…50 sin repetir", async () => {
    const hash = hashClave("login:ip", anotar("login:ip", randomUUID()), LLAVE);
    const inicio = new Date(Math.floor(Date.now() / 900_000) * 900_000);
    const numeros = await Promise.all(
      Array.from({ length: 50 }, () => incrementarIntento("login:ip", hash, inicio, prisma)),
    );
    expect([...numeros].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("claves distintas no se suman; la ventana siguiente empieza en 1 y borra la vencida", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const t0 = Date.UTC(2026, 10, 19, 15, 7, 30);
    let ahora = t0;
    const ha = ruta("login:account", a, () => ahora);
    for (let i = 0; i < 6; i++) await ha(peticion());
    expect((await ha(peticion())).status).toBe(429);
    expect((await ruta("login:account", b, () => ahora)(peticion())).status).toBe(204);

    ahora = t0 + 15 * 60 * 1000; // ventana siguiente
    expect((await ha(peticion())).status).toBe(204);
    expect(await fila("login:account", a)).toEqual({ count: 1, filas: 1 });
  });

  it("RNF-PRI-01: la tabla no guarda la clave en claro ni su SHA-256", async () => {
    const correo = `ana.${randomUUID()}@ejemplo.co`;
    await ruta("login:account", correo)(peticion());
    const r = await dueno.query<{ key_hash: Buffer }>(
      "SELECT key_hash FROM rate_limit_counter WHERE scope = 'login:account' AND key_hash = $1",
      [Buffer.from(hashClave("login:account", correo, LLAVE))],
    );
    expect(r.rows).toHaveLength(1);
    const guardado = r.rows[0]!.key_hash;
    expect(guardado.byteLength).toBe(32);
    expect(guardado.toString("latin1")).not.toContain("ana.");
    const sha = await dueno.query<{ n: string }>(
      "SELECT count(*) AS n FROM rate_limit_counter WHERE key_hash = sha256(convert_to($1, 'UTF8'))",
      [correo],
    );
    expect(sha.rows[0]?.n).toBe("0");
  });
});
