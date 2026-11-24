/**
 * Validación de un cuerpo contra su esquema Zod (ADR-007, A-8, F4-05b).
 *
 * Error → 400 `invalid_request` con `errors: [{ field, rule }]`. Nunca el valor recibido ni el
 * mensaje de Zod (podría repetir lo que mandó el cliente, p. ej. un correo o una contraseña).
 */
import type { z } from "zod";
import { ErrorApi } from "./errores";

const REGLA = /^[a-z_]{1,40}$/;

export function validar<T extends z.ZodType>(esquema: T, valor: unknown): z.output<T> {
  const r = esquema.safeParse(valor);
  if (r.success) return r.data;
  const errors = r.error.issues.slice(0, 20).map((i) => {
    const field = i.path.length > 0 ? i.path.map(String).join(".") : "body";
    // Un `refine` con `error` propio pone ahí la regla (`too_short`, `too_long`); si no, el código de Zod.
    const rule = REGLA.test(i.message) ? i.message : i.code;
    return { field, rule };
  });
  throw new ErrorApi("invalid_request", { errors });
}
