// Cliente mínimo de /api/v1 para las páginas (F4-05c). Mismo origen: el navegador manda `Origin`
// y la cookie `moneo-sesion` (HttpOnly) sola; aquí nunca se toca un token de sesión.

export type Problema = { code: string; status: number; requestId?: string };
export type Resultado<T> =
  { ok: true; status: number; datos: T } | { ok: false; problema: Problema };

export async function llamar<T = null>(
  ruta: string,
  metodo: "GET" | "POST",
  cuerpo?: unknown,
): Promise<Resultado<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${ruta}`, {
      method: metodo,
      headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, problema: { code: "network", status: 0 } };
  }
  const texto = await res.text();
  let json: unknown = null;
  if (texto) {
    try {
      json = JSON.parse(texto);
    } catch {
      // Cuerpo que no es JSON (p. ej. una página de error del proxy): se trata como sin detalles.
    }
  }
  if (res.ok) return { ok: true, status: res.status, datos: json as T };
  const p = (json ?? {}) as { code?: string; requestId?: string };
  return {
    ok: false,
    problema: {
      code: p.code ?? "internal",
      status: res.status,
      requestId: p.requestId ?? res.headers.get("X-Request-Id") ?? undefined,
    },
  };
}

const TEXTOS: Record<string, string> = {
  network: "No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.",
  invalid_credentials: "Correo o contraseña incorrectos.",
  email_not_confirmed: "Primero confirma tu correo.",
  too_many_attempts: "Demasiados intentos. Espera unos minutos.",
  link_invalid: "El enlace no sirve o ya venció. Pide uno nuevo.",
  origin_mismatch: "No se pudo verificar el origen de la petición.",
  busy: "El servidor está ocupado. Intenta de nuevo en un momento.",
  unavailable: "El servicio no está disponible ahora. Intenta más tarde.",
  invalid_request: "Revisa los datos e intenta de nuevo.",
};

export function textoDeProblema(p: Problema): string {
  const base = TEXTOS[p.code] ?? "Ocurrió un error inesperado.";
  return p.requestId ? `${base} (código ${p.requestId})` : base;
}
