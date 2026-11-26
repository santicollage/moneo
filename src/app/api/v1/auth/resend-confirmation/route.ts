// E-03 · `POST /auth/resend-confirmation`: 202 siempre; `resend:email` 3 por hora.
import { reenviarConfirmacion } from "@/server/shared/auth/cuenta";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";
// R68 (F4-06a-D2): tope propio; Hobby da 300 s por defecto. El peor camino (E-09) ronda 17 s.
export const maxDuration = 25;

export const POST = manejar(
  { ruta: "/api/v1/auth/resend-confirmation", metodo: "POST" },
  withPolicy("E-03", (ctx) => reenviarConfirmacion(ctx)),
);
