// E-10 · `GET /me`: perfil y membresías activas de quien llama (perfil `session`).
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";
import { leerMe } from "@/server/perfil/me";

export const dynamic = "force-dynamic";
// R68 (F4-06a-D2): tope propio; Hobby da 300 s por defecto. El peor camino (E-09) ronda 17 s.
export const maxDuration = 25;

export const GET = manejar(
  { ruta: "/api/v1/me", metodo: "GET" },
  withPolicy("E-10", async ({ actor, sesion }) => {
    // `session` garantiza la sesión; el `!` no es una suposición, es lo que verificó `withPolicy`.
    return Response.json(await leerMe(actor, sesion!.correo));
  }),
);
