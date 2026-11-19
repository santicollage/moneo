// E-01 · health check. Público (perfil `public` del registro de rutas).
import { comprobarBase } from "@/server/shared/db/salud";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";
import { crearGetSalud } from "@/server/system/salud";

export const dynamic = "force-dynamic";

const salud = crearGetSalud(() => comprobarBase());

export const GET = manejar(
  { ruta: "/api/v1/health", metodo: "GET" },
  withPolicy("E-01", () => salud()),
);
