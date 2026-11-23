import { describe, expect, it } from "vitest";
import { cargarConfig, ErrorConfig } from "./config";

const CA = "-----BEGIN CERTIFICATE-----\nMIIabc\n-----END CERTIFICATE-----";
const REMOTA =
  "postgresql://moneo_app.ref:SECRETO-XYZ@aws-1-us-east-1.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://moneo_app:SECRETO-XYZ@127.0.0.1:54322/postgres";
const LLAVE = "llave-de-prueba-de-32-caracteres-o-mas";
// Marcadores armados por partes: gitleaks escanea todo el historial (regla de F4-04c).
const PUBLICA = "sb_" + "publishable_" + "MARCADOR-local";
const SUPA_LOCAL = "http://127.0.0.1:54321";
const base = {
  DATABASE_URL: LOCAL,
  APP_ORIGIN: "http://localhost:3000",
  RATE_LIMIT_HASH_KEY: LLAVE,
  SUPABASE_URL: SUPA_LOCAL,
  SUPABASE_PUBLISHABLE_KEY: PUBLICA,
};
/** JWT sin firma válida, solo para la carga: así se ve una clave heredada de Supabase. */
const jwtCon = (carga: object) =>
  ["e30", Buffer.from(JSON.stringify(carga)).toString("base64url"), "firma"].join(".");
const DSN = "https://abc123publica@o4501.ingest.us.sentry.io/4507001";

function problemas(env: Record<string, string | undefined>): string[] {
  try {
    cargarConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorConfig);
    return (e as ErrorConfig).problemas;
  }
  return [];
}

describe("RNF-SEG-11 configuración validada", () => {
  it("local válida: sin TLS", () => {
    expect(cargarConfig(base)).toEqual({
      baseDatos: { url: LOCAL, local: true, ca: undefined },
      appOrigin: "http://localhost:3000",
      entorno: "local",
      enVercel: false,
      version: undefined,
      llaveIntentos: LLAVE,
      sentry: undefined,
      supabase: {
        url: SUPA_LOCAL,
        clavePublica: PUBLICA,
        emisor: `${SUPA_LOCAL}/auth/v1`,
        jwks: `${SUPA_LOCAL}/auth/v1/.well-known/jwks.json`,
      },
      cookiesSeguras: false,
    });
  });

  it("F4-05a: clave heredada anon aceptada; https → cookies seguras", () => {
    const c = cargarConfig({
      ...base,
      SUPABASE_PUBLISHABLE_KEY: jwtCon({ role: "anon" }),
      APP_ORIGIN: "https://moneo.test",
    });
    expect(c.cookiesSeguras).toBe(true);
  });

  it("remota con CA: TLS verify-full; acepta saltos de línea escapados", () => {
    const c = cargarConfig({
      ...base,
      DATABASE_URL: REMOTA,
      DATABASE_CA_CERT: CA.replace(/\n/g, "\\n"),
    });
    expect(c.baseDatos).toEqual({ url: REMOTA, local: false, ca: CA });
  });

  it.each([
    [
      "sin DATABASE_URL",
      { APP_ORIGIN: "http://localhost:3000", RATE_LIMIT_HASH_KEY: LLAVE },
      "DATABASE_URL",
    ],
    ["sin APP_ORIGIN", { DATABASE_URL: LOCAL, RATE_LIMIT_HASH_KEY: LLAVE }, "APP_ORIGIN"],
    [
      "F4-04c sin RATE_LIMIT_HASH_KEY",
      { DATABASE_URL: LOCAL, APP_ORIGIN: "http://localhost:3000" },
      "RATE_LIMIT_HASH_KEY",
    ],
    [
      "F4-04c llave corta",
      { ...base, RATE_LIMIT_HASH_KEY: "corta" },
      "RATE_LIMIT_HASH_KEY: mínimo 32",
    ],
    [
      "F4-04c DSN http",
      { ...base, SENTRY_DSN: DSN.replace("https", "http") },
      "SENTRY_DSN: debe ser una URL https",
    ],
    [
      "F4-04c DSN sin clave",
      { ...base, SENTRY_DSN: "https://o1.ingest.sentry.io/1" },
      "SENTRY_DSN: le falta la clave",
    ],
    [
      "F4-04c DSN con clave secreta",
      { ...base, SENTRY_DSN: "https://pub:sec@o1.ingest.sentry.io/1" },
      "clave secreta",
    ],
    [
      "F4-04c DSN sin proyecto",
      { ...base, SENTRY_DSN: "https://pub@o1.ingest.sentry.io/" },
      "número de proyecto",
    ],
    [
      "F4-04c VERCEL_ENV raro",
      {
        ...base,
        DATABASE_URL: REMOTA,
        DATABASE_CA_CERT: CA,
        APP_ORIGIN: "https://x.vercel.app",
        VERCEL_ENV: "staging",
      },
      "VERCEL_ENV",
    ],
    ["remota sin CA", { ...base, DATABASE_URL: REMOTA }, "DATABASE_CA_CERT: obligatoria"],
    ["CA que no es PEM", { ...base, DATABASE_CA_CERT: "hola" }, "DATABASE_CA_CERT: debe ser"],
    ["sslmode en la URL", { ...base, DATABASE_URL: `${LOCAL}?sslmode=require` }, "sslmode"],
    [
      "sslrootcert en la URL",
      { ...base, DATABASE_URL: `${REMOTA}?sslrootcert=x`, DATABASE_CA_CERT: CA },
      "sslrootcert",
    ],
    ["protocolo ajeno", { ...base, DATABASE_URL: "mysql://x@y/z" }, "postgresql://"],
    ["APP_ORIGIN con ruta", { ...base, APP_ORIGIN: "http://localhost:3000/" }, "solo el origen"],
    [
      "Vercel con base local",
      { ...base, VERCEL_ENV: "preview", APP_ORIGIN: "https://x.vercel.app" },
      "host local",
    ],
    ["F4-05a sin SUPABASE_URL", { ...base, SUPABASE_URL: undefined }, "SUPABASE_URL"],
    [
      "F4-05a sin clave pública",
      { ...base, SUPABASE_PUBLISHABLE_KEY: undefined },
      "SUPABASE_PUBLISHABLE_KEY",
    ],
    [
      "F4-05a clave secreta en la variable pública",
      { ...base, SUPABASE_PUBLISHABLE_KEY: "sb_" + "secret_" + "MARCADOR" },
      "SUPABASE_PUBLISHABLE_KEY: es una clave SECRETA",
    ],
    [
      "F4-05a service_role heredada en la variable pública",
      { ...base, SUPABASE_PUBLISHABLE_KEY: jwtCon({ role: "service_role" }) },
      "service_role",
    ],
    [
      "F4-05a clave con otra forma",
      { ...base, SUPABASE_PUBLISHABLE_KEY: "cualquier-cosa" },
      "sb_publishable_",
    ],
    ["F4-05a SUPABASE_URL con ruta", { ...base, SUPABASE_URL: `${SUPA_LOCAL}/` }, "solo el origen"],
    [
      "F4-05a Vercel con Supabase local",
      {
        ...base,
        DATABASE_URL: REMOTA,
        DATABASE_CA_CERT: CA,
        APP_ORIGIN: "https://x.vercel.app",
        VERCEL_ENV: "preview",
      },
      "SUPABASE_URL: en Vercel",
    ],
    [
      "Vercel con http",
      { ...base, DATABASE_URL: REMOTA, DATABASE_CA_CERT: CA, VERCEL_ENV: "production" },
      "https",
    ],
  ])("falla: %s", (_n, env, esperado) => {
    expect(problemas(env).join(" | ")).toContain(esperado);
  });

  it("F4-04c: DSN válido → endpoint de envelopes; Vercel → entorno, IP de Vercel y versión", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const c = cargarConfig({
      ...base,
      DATABASE_URL: REMOTA,
      DATABASE_CA_CERT: CA,
      APP_ORIGIN: "https://moneo.vercel.app",
      SUPABASE_URL: "https://ref.supabase.co",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: sha,
      SENTRY_DSN: ` ${DSN} `,
    });
    expect(c.sentry).toEqual({
      endpoint: "https://o4501.ingest.us.sentry.io/api/4507001/envelope/",
      clavePublica: "abc123publica",
      dsn: DSN,
    });
    expect([c.entorno, c.enVercel, c.version]).toEqual(["preview", true, sha]);
    // Un SHA que no es SHA no llega a Sentry.
    expect(cargarConfig({ ...base, VERCEL_GIT_COMMIT_SHA: "rama-x" }).version).toBeUndefined();
    // DSN con prefijo de ruta (Sentry propio): el prefijo se conserva.
    expect(
      cargarConfig({ ...base, SENTRY_DSN: "https://k@errores.ejemplo.co/sub/7" }).sentry?.endpoint,
    ).toBe("https://errores.ejemplo.co/sub/api/7/envelope/");
    // Vacía = sin Sentry.
    expect(cargarConfig({ ...base, SENTRY_DSN: "" }).sentry).toBeUndefined();
  });

  it("el error nunca contiene el valor de una variable (la contraseña va en DATABASE_URL)", () => {
    const envs = [
      { DATABASE_URL: `${REMOTA}?sslmode=require`, APP_ORIGIN: "nada" },
      { DATABASE_URL: "SECRETO-XYZ", APP_ORIGIN: "SECRETO-XYZ" },
      { ...base, RATE_LIMIT_HASH_KEY: "SECRETO-XYZ" },
      { ...base, SENTRY_DSN: "http://SECRETO-XYZ@o1.ingest.sentry.io/1" },
      { ...base, SUPABASE_PUBLISHABLE_KEY: "sb_" + "secret_" + "SECRETO-XYZ" },
      { ...base, SUPABASE_URL: "SECRETO-XYZ" },
    ];
    for (const env of envs) {
      try {
        cargarConfig(env);
        expect.unreachable();
      } catch (e) {
        expect(String((e as Error).message)).not.toContain("SECRETO-XYZ");
        expect(JSON.stringify(e)).not.toContain("SECRETO-XYZ");
      }
    }
  });
});
