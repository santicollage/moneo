/** E-01 · `GET /api/v1/health` (`system.health`): `{ status: "ok" }` fijo o 503 `unavailable`. */
import { ErrorApi } from "../shared/http/errores";

export function crearGetSalud(comprobar: () => Promise<boolean>) {
  return async (): Promise<Response> => {
    if (!(await comprobar())) throw new ErrorApi("unavailable");
    return Response.json({ status: "ok" });
  };
}
