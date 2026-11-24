/**
 * Contratos de entrada de autenticación (ADR-007, `12-diseno-api.md` §2.1, F4-05b).
 *
 * - Correo: sin espacios a los lados y en minúsculas (Supabase Auth también lo guarda así).
 * - Contraseña (DN-1): al menos 15 caracteres y como máximo 72 BYTES en UTF-8. bcrypt, que usa
 *   Supabase, solo mira los primeros 72 bytes: una tilde ocupa 2, así que 72 caracteres con tildes
 *   pasarían de 72 bytes y el final se ignoraría en silencio. Nunca se recorta ni se normaliza.
 * - `invitationToken` existe en el contrato, pero hasta F5-01 se rechaza con 400 (F4-05b-D3).
 */
import { z } from "zod";

export const CONTRASENA_MIN_CARACTERES = 15;
export const CONTRASENA_MAX_BYTES = 72;

const bytesUtf8 = (s: string) => new TextEncoder().encode(s).length;

export const Correo = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const Contrasena = z
  .string()
  .refine((s) => [...s].length >= CONTRASENA_MIN_CARACTERES, { error: "too_short" })
  .refine((s) => bytesUtf8(s) <= CONTRASENA_MAX_BYTES, { error: "too_long" });

/** Igual que `profile.display_name` (VARCHAR(60)). */
export const NombreVisible = z.string().trim().min(1).max(60);

export const Registro = z.strictObject({
  email: Correo,
  password: Contrasena,
  displayName: NombreVisible,
  invitationToken: z.string().min(1).max(200).optional(),
});

export const SoloCorreo = z.strictObject({ email: Correo });

const TokenHash = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/** E-04: lo que la página `/confirmar` lee del fragmento del enlace y envía por POST. Solo registro. */
export const Confirmacion = z.strictObject({
  tokenHash: TokenHash,
  type: z.literal("email"),
});

/**
 * E-09 (F4-05b-D4): el enlace de recuperación NO abre sesión por E-04. La página `/restablecer`
 * guarda el `token_hash` del fragmento y lo envía junto con la contraseña nueva.
 */
export const Restablecimiento = z.strictObject({
  tokenHash: TokenHash,
  password: Contrasena,
});

export const Login = z.strictObject({
  email: Correo,
  // En el login no se aplican las reglas de DN-1: una contraseña vieja más corta igual se prueba.
  password: z.string().min(1).max(200),
});

export const RespuestaRegistro = z.strictObject({ status: z.literal("check_email") });
