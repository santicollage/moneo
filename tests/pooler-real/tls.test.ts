/**
 * F4-04a · TLS `verify-full` del cliente de la app contra el pooler de Supabase (STAGING, 6543).
 * MANUAL: `pnpm test:pooler-real` con las variables de F4-03d más
 *   MONEO_CA_CERT_PATH = ruta al certificado del proyecto
 *   (panel → Database Settings → SSL Configuration → Download certificate).
 * Prueba la configuración REAL de la app (`configPool`), no una copia:
 *   1. Con la CA del proyecto: conecta.
 *   2. Sin la CA (solo las raíces públicas de Node): rechaza el certificado → se verifica la cadena.
 *   3. Por IP en vez del nombre: rechaza → se verifica el nombre del host (la parte «full»).
 */
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { configPool } from "@/server/shared/db/client";
import { entorno, medida } from "./_comun";

const env = entorno();
const rutaCa = process.env.MONEO_CA_CERT_PATH;
if (!rutaCa) throw new Error("Falta MONEO_CA_CERT_PATH (certificado del proyecto de Supabase).");
const ca = readFileSync(rutaCa, "utf8");

/** Sin parámetros de TLS en la URL: los fija el código (la configuración de la app los rechaza). */
const url = (() => {
  const u = new URL(env.appTxUrl);
  u.search = "";
  return u.toString();
})();

async function probar(cfg: pg.ClientConfig): Promise<string> {
  const c = new pg.Client(cfg);
  c.on("error", () => {});
  try {
    await c.connect();
    const r = await c.query<{ x: number }>("SELECT 1 AS x");
    return r.rows[0]?.x === 1 ? "ok" : "sin filas";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    await c.end().catch(() => {});
  }
}

describe("F4-04a TLS verify-full por el pooler (staging)", () => {
  it("con la CA del proyecto: conecta", async () => {
    const r = await probar(configPool({ url, local: false, ca }));
    medida("tls-con-ca", r);
    expect(r).toBe("ok");
  });

  it("sin la CA: rechaza el certificado", async () => {
    const r = await probar({
      ...configPool({ url, local: false, ca }),
      ssl: { rejectUnauthorized: true },
    });
    medida("tls-sin-ca", r);
    expect(r).not.toBe("ok");
    expect(r).toMatch(/certificate|self.signed|issuer/i);
  });

  it("por IP en vez del nombre: rechaza (verificación del host)", async () => {
    const u = new URL(url);
    const { address } = await lookup(u.hostname, { family: 4 });
    u.hostname = address;
    const r = await probar(configPool({ url: u.toString(), local: false, ca }));
    medida("tls-por-ip", r);
    expect(r).not.toBe("ok");
    expect(r).toMatch(/altnames|does not match|IP/i);
  });
});
