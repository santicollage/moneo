// E-06 · `POST /auth/logout`: cierra solo esta sesión (EN-9, `scope: "local"`).
import { cerrarSesionDePeticion } from "@/server/shared/auth/cerrar-sesion";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";
// R68 (F4-06a-D2): tope propio; Hobby da 300 s por defecto. El peor camino (E-09) ronda 17 s.
export const maxDuration = 25;

export const POST = manejar(
  { ruta: "/api/v1/auth/logout", metodo: "POST" },
  withPolicy("E-06", ({ peticion }) => cerrarSesionDePeticion(peticion, "local")),
);
