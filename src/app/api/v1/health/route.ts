// E-01 · health check. Público (perfil `public` del registro de rutas).
import { comprobarBase } from "@/server/shared/db/salud";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";
import { crearGetSalud } from "@/server/system/salud";

export const dynamic = "force-dynamic";
// R68 (F4-06a-D2): tope propio; Hobby da 300 s por defecto. El peor camino (E-09) ronda 17 s.
export const maxDuration = 25;

const salud = crearGetSalud(() => comprobarBase());

export const GET = manejar(
  { ruta: "/api/v1/health", metodo: "GET" },
  withPolicy("E-01", () => salud()),
);
