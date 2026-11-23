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
 *   - F4-04c: `RATE_LIMIT_HASH_KEY` es obligatoria en todo entorno (sin ella no hay límite de
 *     intentos, RNF-SEG-02); `SENTRY_DSN` es opcional (vacía = no se reporta nada).
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

/** Destino de Sentry sacado del DSN (O-7, F4-04c-D1: envío propio, sin SDK). */
export type ConfigSentry = {
  /** `https://<host>/api/<proyecto>/envelope/`. */
  endpoint: string;
  /** Clave pública del DSN (no es secreta: Sentry la pone en el navegador en otros proyectos). */
  clavePublica: string;
  /** El DSN tal cual, para la cabecera del envelope. */
  dsn: string;
};

export type Entorno = "production" | "preview" | "development" | "local";

export type Config = {
  baseDatos: ConfigBaseDatos;
  /** Origen de la app para la comprobación de `Origin` (RNF-SEG-07). */
  appOrigin: string;
  /** `VERCEL_ENV`, o `local` fuera de Vercel. */
  entorno: Entorno;
  /** En Vercel la IP del cliente sale de una cabecera que pone su proxy (`ip.ts`). */
  enVercel: boolean;
  /** Commit desplegado (`VERCEL_GIT_COMMIT_SHA`), si es un SHA válido. Va a Sentry como `release`. */
  version: string | undefined;
  /** Llave del HMAC de `rate_limit_counter.key_hash` (RNF-PRI-01: nunca el correo ni la IP en claro). */
  llaveIntentos: string;
  sentry: ConfigSentry | undefined;
};

const esquema = z
  .object({
    DATABASE_URL: z.string({ error: "falta" }).min(1, { error: "falta" }),
    DATABASE_CA_CERT: z.string().optional(),
    APP_ORIGIN: z.string({ error: "falta" }).min(1, { error: "falta" }),
    VERCEL_ENV: z.string().optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
    RATE_LIMIT_HASH_KEY: z.string({ error: "falta" }).min(1, { error: "falta" }),
    SENTRY_DSN: z.string().optional(),
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

const ENTORNOS_VERCEL = new Set(["production", "preview", "development"]);
const SHA = /^[0-9a-f]{40}$/;
/** 32 bytes al azar en base64 son 44 caracteres; menos de 32 caracteres es una llave débil. */
const LARGO_MINIMO_LLAVE = 32;

/** DSN moderno: `https://<clave>@<host>[/<prefijo>]/<proyecto>`. Sin la clave secreta heredada. */
function leerDsn(valor: string): ConfigSentry | string {
  const u = leerUrl(valor);
  if (!u || u.protocol !== "https:") return "debe ser una URL https";
  if (!u.username) return "le falta la clave pública";
  if (u.password) return "trae la clave secreta heredada; usa el DSN sin ella";
  if (u.search || u.hash) return "no lleva parámetros";
  const partes = u.pathname.split("/").filter(Boolean);
  const proyecto = partes.pop();
  if (!proyecto || !/^\d+$/.test(proyecto)) return "le falta el número de proyecto";
  const prefijo = partes.length > 0 ? `/${partes.join("/")}` : "";
  return {
    endpoint: `https://${u.host}${prefijo}/api/${proyecto}/envelope/`,
    clavePublica: decodeURIComponent(u.username),
    dsn: valor,
  };
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

  if (e.VERCEL_ENV && !ENTORNOS_VERCEL.has(e.VERCEL_ENV)) {
    problemas.push("VERCEL_ENV: debe ser production, preview o development");
  }

  if (e.RATE_LIMIT_HASH_KEY.length < LARGO_MINIMO_LLAVE) {
    problemas.push(
      `RATE_LIMIT_HASH_KEY: mínimo ${LARGO_MINIMO_LLAVE} caracteres (32 bytes al azar en base64)`,
    );
  }

  let sentry: ConfigSentry | undefined;
  const dsn = e.SENTRY_DSN?.trim();
  if (dsn) {
    const r = leerDsn(dsn);
    if (typeof r === "string") problemas.push(`SENTRY_DSN: ${r}`);
    else sentry = r;
  }

  if (problemas.length > 0) throw new ErrorConfig(problemas);
  return {
    baseDatos: { url: e.DATABASE_URL, local, ca },
    appOrigin: e.APP_ORIGIN,
    entorno: (e.VERCEL_ENV as Entorno | undefined) ?? "local",
    enVercel: Boolean(e.VERCEL_ENV),
    version:
      e.VERCEL_GIT_COMMIT_SHA && SHA.test(e.VERCEL_GIT_COMMIT_SHA)
        ? e.VERCEL_GIT_COMMIT_SHA
        : undefined,
    llaveIntentos: e.RATE_LIMIT_HASH_KEY,
    sentry,
  };
}

let cache: Config | undefined;

/** Configuración del proceso (se valida una vez). */
export function config(): Config {
  cache ??= cargarConfig(process.env);
  return cache;
}
