/**
 * Configuración del servidor validada con Zod (RNF-SEG-11, `seguridad.md` §8, F4-04a).
 *
 * Reglas:
 *   - Se valida al arrancar (`src/instrumentation.ts`) y la primera vez que se pide: si falta una
 *     variable o está mal, el proceso no sirve peticiones.
 *   - Los mensajes de error nombran la VARIABLE y la regla, nunca el valor: DATABASE_URL lleva la
 *     contraseña de `moneo_app`.
 *   - Solo contiene lo que el código ya usa. Cada sub-paso suma sus variables (F4-04c: Sentry y la
 *     clave del límite de intentos; F4-05: Supabase Auth y la lista permitida).
 */
import { z } from "zod";

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Parámetros de TLS en la URL que `pg` aplicaría por encima de la configuración del código. */
const PARAMETROS_TLS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];

export type ConfigBaseDatos = {
  url: string;
  /** Host local (Supabase local o el Postgres del CI): sin TLS. */
  local: boolean;
  /** CA del proyecto de Supabase (PEM). Obligatoria fuera de local: `verify-full`. */
  ca: string | undefined;
};

export type Config = {
  baseDatos: ConfigBaseDatos;
  /** Origen de la app para la comprobación de `Origin` (RNF-SEG-07). */
  appOrigin: string;
};

const esquema = z
  .object({
    DATABASE_URL: z.string({ error: "falta" }).min(1, { error: "falta" }),
    DATABASE_CA_CERT: z.string().optional(),
    APP_ORIGIN: z.string({ error: "falta" }).min(1, { error: "falta" }),
    VERCEL_ENV: z.string().optional(),
  })
  .loose();

/** Error de configuración: solo nombres de variables y reglas. */
export class ErrorConfig extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Configuración inválida: ${problemas.join("; ")}`);
    this.name = "ErrorConfig";
  }
}

function leerUrl(valor: string): URL | undefined {
  try {
    return new URL(valor);
  } catch {
    return undefined;
  }
}

/** Valida un entorno (por defecto `process.env`). Función pura: es lo que prueban las pruebas. */
export function cargarConfig(env: Record<string, string | undefined>): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    // Solo la ruta (nombre de la variable) y el mensaje propio; nunca `input`.
    throw new ErrorConfig(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const e = r.data;
  const problemas: string[] = [];

  const url = leerUrl(e.DATABASE_URL);
  let local = false;
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol)) {
    problemas.push("DATABASE_URL: debe ser una URL postgresql://");
  } else {
    local = HOSTS_LOCALES.has(url.hostname);
    for (const p of PARAMETROS_TLS) {
      if (url.searchParams.has(p)) {
        problemas.push(
          `DATABASE_URL: quita el parámetro ${p}; el modo TLS lo fija el código (verify-full)`,
        );
      }
    }
    if (local && e.VERCEL_ENV) {
      problemas.push("DATABASE_URL: en Vercel no puede apuntar a un host local");
    }
  }

  // En Vercel la CA puede llegar con saltos de línea escapados.
  const ca = e.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim() || undefined;
  if (ca && !ca.includes("-----BEGIN CERTIFICATE-----")) {
    problemas.push("DATABASE_CA_CERT: debe ser un certificado PEM");
  }
  if (url && !local && !ca) {
    problemas.push("DATABASE_CA_CERT: obligatoria fuera de local (TLS verify-full)");
  }

  const origen = leerUrl(e.APP_ORIGIN);
  if (!origen || !["http:", "https:"].includes(origen.protocol)) {
    problemas.push("APP_ORIGIN: debe ser una URL http(s)");
  } else if (origen.origin !== e.APP_ORIGIN) {
    problemas.push("APP_ORIGIN: solo el origen, sin ruta ni barra final");
  } else if (e.VERCEL_ENV && origen.protocol !== "https:") {
    problemas.push("APP_ORIGIN: en Vercel debe ser https");
  }

  if (problemas.length > 0) throw new ErrorConfig(problemas);
  return {
    baseDatos: { url: e.DATABASE_URL, local, ca },
    appOrigin: e.APP_ORIGIN,
  };
}

let cache: Config | undefined;

/** Configuración del proceso (se valida una vez). */
export function config(): Config {
  cache ??= cargarConfig(process.env);
  return cache;
}
