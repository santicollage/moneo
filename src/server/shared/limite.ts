/**
 * Límite de intentos (RNF-SEG-02, RNF-SEG-03, RNF-SEG-05, DN-2, `12-diseno-api.md` §1.5, F4-04c).
 *
 * - Ventana FIJA: `window_start` = inicio del bloque de `ventanaSegundos` en que cae «ahora».
 *   Costo conocido: en el borde de dos ventanas caben hasta 2 × `maximo` intentos seguidos. Para
 *   5 contraseñas por cuenta en 15 min sigue siendo inútil para adivinar (DN-1: 15 caracteres).
 * - Se cuenta ANTES de hacer el trabajo: el intento que se pasa del máximo recibe 429 aunque traiga
 *   la contraseña correcta (RNF-SEG-02). Qué hacer con un acierto lo decide F4-05.
 * - `key_hash` = HMAC-SHA256(RATE_LIMIT_HASH_KEY, scope ‖ clave): con un SHA-256 simple, un correo o
 *   una IP se recuperan probando candidatos; sin la llave, no (RNF-PRI-01). Rotar la llave reinicia
 *   todos los contadores, nada más.
 * - El incremento es atómico en la base (`db/intentos.ts`, EN-13), nunca en memoria: Vercel corre
 *   varias instancias.
 */
import { createHmac } from "node:crypto";
import { config } from "./config";
import { borrarIntentos, incrementarIntento } from "./db/intentos";
import { ErrorApi } from "./http/errores";

/** Límites de `12-diseno-api.md` §1.5. `scope` cabe en `VARCHAR(32)`. */
export const LIMITES = {
  "login:account": { maximo: 5, ventanaSegundos: 15 * 60 },
  "login:ip": { maximo: 20, ventanaSegundos: 15 * 60 },
  "invite:accept": { maximo: 10, ventanaSegundos: 15 * 60 },
  /** Recuperar contraseña: al pasarse, 202 genérico sin enviar correo (RNF-SEG-03). */
  "recovery:email": { maximo: 3, ventanaSegundos: 60 * 60 },
  /** Reenviar confirmación: igual que recuperar. */
  "resend:email": { maximo: 3, ventanaSegundos: 60 * 60 },
} as const satisfies Record<string, { maximo: number; ventanaSegundos: number }>;

export type Ambito = keyof typeof LIMITES;

export type ResultadoIntento = {
  permitido: boolean;
  /** Número de este intento dentro de la ventana (1, 2, …). */
  intento: number;
  /** Segundos hasta que abre la ventana siguiente (≥ 1). Es el `Retry-After` del 429. */
  reintentoSegundos: number;
};

export type DependenciasLimite = {
  llave: () => string;
  ahora: () => number;
  incrementar: (scope: string, hash: Uint8Array<ArrayBuffer>, inicio: Date) => Promise<number>;
  borrar: (scope: string, hash: Uint8Array<ArrayBuffer>) => Promise<void>;
};

const porDefecto: DependenciasLimite = {
  llave: () => config().llaveIntentos,
  ahora: () => Date.now(),
  incrementar: (scope, hash, inicio) => incrementarIntento(scope, hash, inicio),
  borrar: (scope, hash) => borrarIntentos(scope, hash),
};

/** HMAC-SHA256 de `ambito` + separador + `clave`: 32 bytes. El ámbito evita reusar un hash entre contadores. */
export function hashClave(ambito: Ambito, clave: string, llave: string): Uint8Array<ArrayBuffer> {
  const mac = createHmac("sha256", llave).update(`${ambito}\u0000${clave}`, "utf8").digest();
  return new Uint8Array(mac);
}

/** Inicio de la ventana fija que contiene `ahoraMs` (en UTC, alineada a la época). */
export function inicioVentana(ahoraMs: number, ventanaSegundos: number): Date {
  const largo = ventanaSegundos * 1000;
  return new Date(Math.floor(ahoraMs / largo) * largo);
}

/** Correo como clave: sin espacios, NFC y en minúsculas (el mismo correo escrito distinto cuenta igual). */
export function claveCorreo(correo: string): string {
  return correo.trim().normalize("NFC").toLowerCase();
}

/** Cuenta un intento y dice si está dentro del límite. No lanza por pasarse: eso lo decide quien llama. */
export async function registrarIntento(
  ambito: Ambito,
  clave: string,
  deps: Partial<DependenciasLimite> = {},
): Promise<ResultadoIntento> {
  const d: DependenciasLimite = { ...porDefecto, ...deps };
  const { maximo, ventanaSegundos } = LIMITES[ambito];
  const ahora = d.ahora();
  const inicio = inicioVentana(ahora, ventanaSegundos);
  const intento = await d.incrementar(ambito, hashClave(ambito, clave, d.llave()), inicio);
  const fin = inicio.getTime() + ventanaSegundos * 1000;
  return {
    permitido: intento <= maximo,
    intento,
    reintentoSegundos: Math.max(1, Math.ceil((fin - ahora) / 1000)),
  };
}

/** Como `registrarIntento`, pero al pasarse lanza 429 `too_many_attempts` con `Retry-After`. */
export async function exigirIntento(
  ambito: Ambito,
  clave: string,
  deps: Partial<DependenciasLimite> = {},
): Promise<void> {
  const r = await registrarIntento(ambito, clave, deps);
  if (!r.permitido) throw new ErrorApi("too_many_attempts", undefined, r.reintentoSegundos);
}

/**
 * Pone en cero el contador de una clave (todas sus ventanas). Solo para «un login correcto borra los
 * fallos de esa cuenta» (F4-05c, RNF-SEG-02). NO se usa con `login:ip`: el límite por IP sigue
 * contando todo, para que una cuenta propia no sirva de llave para probar contraseñas ajenas.
 */
export async function reiniciarIntentos(
  ambito: Ambito,
  clave: string,
  deps: Partial<DependenciasLimite> = {},
): Promise<void> {
  const d: DependenciasLimite = { ...porDefecto, ...deps };
  await d.borrar(ambito, hashClave(ambito, clave, d.llave()));
}
