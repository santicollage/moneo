/**
 * Proxy de Next 16 (antes «middleware»). ÚNICO lugar que refresca la sesión (EN-11, G3-D1, R54).
 *
 * - Si al token le quedan ≤ 60 s, lo refresca y copia las cookies nuevas a la PETICIÓN (para que el
 *   Route Handler o la página de esta misma petición vea el token nuevo) y a la RESPUESTA (para el
 *   navegador). Si no, deja pasar la petición sin llamar a Supabase.
 * - No consulta la base de datos ni autoriza: autorizar es de `withPolicy` en cada Route Handler.
 * - Si el refresco falla por red, la petición sigue con la cookie que traía (el verificador decide).
 */
import { NextResponse, type NextRequest } from "next/server";
import { refrescarSiHaceFalta, type DependenciasRefresco } from "@/server/shared/auth/refresco";
import { logger } from "@/server/shared/log";

/** Fábrica con dependencias inyectables (pruebas). Next llama a `proxy(request, evento)`. */
export function crearProxy(deps: Partial<DependenciasRefresco> = {}) {
  return async function proxy(request: NextRequest): Promise<NextResponse> {
    let r: Awaited<ReturnType<typeof refrescarSiHaceFalta>>;
    try {
      r = await refrescarSiHaceFalta(request.cookies.getAll(), deps);
    } catch (err) {
      const nombre = err instanceof Error ? err.name : "unknown";
      logger.warn("session_refresh_failed", {
        errorCode: /^\w{1,40}$/.test(nombre) ? nombre : "unknown",
      });
      return NextResponse.next();
    }

    if (r.estado === "no_aplica") return NextResponse.next();
    if (r.estado === "fallo") {
      logger.warn("session_refresh_failed", { errorCode: r.errorCode });
      return NextResponse.next();
    }

    for (const c of r.cookies) {
      if (c.value === "" || c.options.maxAge === 0) request.cookies.delete(c.name);
      else request.cookies.set(c.name, c.value);
    }
    const respuesta = NextResponse.next({ request });
    for (const c of r.cookies) respuesta.cookies.set(c.name, c.value, c.options);
    for (const [k, v] of Object.entries(r.cabeceras)) respuesta.headers.set(k, v);
    return respuesta;
  };
}

export const proxy = crearProxy();

// Incluye /api/v1 (EN-11). Excluye estáticos, imágenes, íconos, manifiesto y service worker.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
