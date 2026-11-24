/**
 * Respuestas de error RFC 9457 (A-8, `12-diseno-api.md` §1.6, EN-7).
 *
 * - `type` = `urn:moneo:problem:<code>`; el cliente decide por `code`.
 * - El 404 es un cuerpo FIJO, byte a byte igual en toda la API (S-5): sin `detail`, sin `instance`
 *   y sin `requestId` (el id va solo en la cabecera `X-Request-Id`). Así se compara en T-4.
 * - Ninguna respuesta lleva mensajes de Postgres, de Prisma ni valores recibidos.
 */

export const CATALOGO = {
  invalid_request: { status: 400, title: "La petición no es válida" },
  invalid_cursor: { status: 400, title: "El cursor no es válido" },
  idempotency_key_missing: { status: 400, title: "Falta la cabecera Idempotency-Key" },
  /** F4-05b: E-04 con un enlace vencido, ya usado o alterado. */
  link_invalid: { status: 400, title: "El enlace no sirve o ya venció" },
  unauthenticated: { status: 401, title: "Inicia sesión" },
  invalid_credentials: { status: 401, title: "Correo o contraseña incorrectos" },
  forbidden: { status: 403, title: "No tienes permiso para esto" },
  origin_mismatch: { status: 403, title: "Origen no permitido" },
  /** F4-05b: E-05 con la contraseña CORRECTA y el correo sin confirmar (no revela si el correo existe). */
  email_not_confirmed: { status: 403, title: "Confirma tu correo antes de entrar" },
  not_found: { status: 404, title: "No encontrado" },
  version_conflict: { status: 409, title: "Alguien cambió esto antes que tú" },
  balance_changed: { status: 409, title: "El saldo cambió mientras ajustabas" },
  insufficient_unassigned: { status: 409, title: "No alcanza lo que hay por asignar" },
  preview_stale: { status: 409, title: "La vista previa cambió" },
  resource_archived: { status: 409, title: "Está archivado" },
  has_balance: { status: 409, title: "La cuenta tiene saldo" },
  has_movements: { status: 409, title: "La cuenta tiene movimientos" },
  negative_available: { status: 409, title: "La categoría tiene disponible negativo" },
  name_taken: { status: 409, title: "Ese nombre ya existe" },
  holder_inactive: { status: 409, title: "El titular ya no es miembro" },
  already_voided: { status: 409, title: "Ya está anulado" },
  not_editable: { status: 409, title: "No se puede editar" },
  already_in_space: { status: 409, title: "Ya perteneces a un espacio" },
  already_member: { status: 409, title: "Ya eres miembro de este espacio" },
  space_full: { status: 409, title: "El espacio está completo" },
  payload_too_large: { status: 413, title: "La petición es demasiado grande" },
  invalid_reference: { status: 422, title: "Una referencia no es válida" },
  date_out_of_range: { status: 422, title: "La fecha está fuera de rango" },
  period_out_of_range: { status: 422, title: "El periodo está fuera de rango" },
  amount_out_of_range: { status: 422, title: "El monto está fuera de rango" },
  range_too_large: { status: 422, title: "El rango es demasiado amplio" },
  idempotency_key_reused: {
    status: 422,
    title: "La clave de idempotencia ya se usó con otro cuerpo",
  },
  too_many_attempts: { status: 429, title: "Demasiados intentos" },
  internal: { status: 500, title: "Error interno" },
  /** F4-04a: tiempo límite o conexión cortada; la transacción se deshizo y se puede reintentar. */
  busy: { status: 503, title: "Ocupado; vuelve a intentar" },
  /** F4-04a: E-01 cuando la base no responde. */
  unavailable: { status: 503, title: "Servicio no disponible" },
} as const satisfies Record<string, { status: number; title: string }>;

export type CodigoProblema = keyof typeof CATALOGO;

/** Extensiones permitidas (§1.6). Nada de valores recibidos: `errors` solo lleva campo y regla. */
export type ExtensionesProblema = {
  errors?: { field: string; rule: string }[];
  field?: string;
  maxAssignable?: string;
  shortfall?: string;
  preview?: unknown;
  archivedId?: string;
};

/** Segundos de `Retry-After` por código. */
const REINTENTO: Partial<Record<CodigoProblema, number>> = { busy: 1 };

export const CUERPO_404 = JSON.stringify({
  type: "urn:moneo:problem:not_found",
  title: CATALOGO.not_found.title,
  status: 404,
  code: "not_found",
});

export function cuerpoProblema(
  codigo: CodigoProblema,
  requestId: string,
  extensiones: ExtensionesProblema = {},
): string {
  if (codigo === "not_found") return CUERPO_404;
  const { status, title } = CATALOGO[codigo];
  // Orden fijo de claves: type, title, status, code, extensiones, requestId.
  return JSON.stringify({
    type: `urn:moneo:problem:${codigo}`,
    title,
    status,
    code: codigo,
    ...extensiones,
    requestId,
  });
}

export function respuestaProblema(
  codigo: CodigoProblema,
  requestId: string,
  extensiones?: ExtensionesProblema,
  reintentoSegundos?: number,
): Response {
  const headers = new Headers({ "Content-Type": "application/problem+json" });
  const reintento = reintentoSegundos ?? REINTENTO[codigo];
  if (reintento !== undefined) headers.set("Retry-After", String(reintento));
  return new Response(cuerpoProblema(codigo, requestId, extensiones), {
    status: CATALOGO[codigo].status,
    headers,
  });
}
