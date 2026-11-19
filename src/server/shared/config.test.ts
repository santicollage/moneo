import { describe, expect, it } from "vitest";
import { cargarConfig, ErrorConfig } from "./config";

const CA = "-----BEGIN CERTIFICATE-----\nMIIabc\n-----END CERTIFICATE-----";
const REMOTA =
  "postgresql://moneo_app.ref:SECRETO-XYZ@aws-1-us-east-1.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://moneo_app:SECRETO-XYZ@127.0.0.1:54322/postgres";
const base = { DATABASE_URL: LOCAL, APP_ORIGIN: "http://localhost:3000" };

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
    });
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
    ["sin DATABASE_URL", { APP_ORIGIN: "http://localhost:3000" }, "DATABASE_URL"],
    ["sin APP_ORIGIN", { DATABASE_URL: LOCAL }, "APP_ORIGIN"],
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
    [
      "Vercel con http",
      { ...base, DATABASE_URL: REMOTA, DATABASE_CA_CERT: CA, VERCEL_ENV: "production" },
      "https",
    ],
  ])("falla: %s", (_n, env, esperado) => {
    expect(problemas(env).join(" | ")).toContain(esperado);
  });

  it("el error nunca contiene el valor de una variable (la contraseña va en DATABASE_URL)", () => {
    const envs = [
      { DATABASE_URL: `${REMOTA}?sslmode=require`, APP_ORIGIN: "nada" },
      { DATABASE_URL: "SECRETO-XYZ", APP_ORIGIN: "SECRETO-XYZ" },
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
