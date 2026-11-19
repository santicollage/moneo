// E-01 · health check. Público (perfil `public` del registro de rutas en F4-04b).
import { comprobarBase } from "@/server/shared/db/salud";
import { manejar } from "@/server/shared/http/manejar";
import { crearGetSalud } from "@/server/system/salud";

export const dynamic = "force-dynamic";

export const GET = manejar(
  { ruta: "/api/v1/health", metodo: "GET" },
  crearGetSalud(() => comprobarBase()),
);
