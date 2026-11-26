// E-07 · `POST /auth/logout-all`: cierra todas las sesiones (EN-9, `scope: "global"`; R57).
import { cerrarSesionDePeticion } from "@/server/shared/auth/cerrar-sesion";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";
// R68 (F4-06a-D2): tope propio; Hobby da 300 s por defecto. El peor camino (E-09) ronda 17 s.
export const maxDuration = 25;

export const POST = manejar(
  { ruta: "/api/v1/auth/logout-all", metodo: "POST" },
  withPolicy("E-07", ({ peticion }) => cerrarSesionDePeticion(peticion, "global")),
);
