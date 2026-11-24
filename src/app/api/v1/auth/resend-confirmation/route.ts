// E-03 · `POST /auth/resend-confirmation`: 202 siempre; `resend:email` 3 por hora.
import { reenviarConfirmacion } from "@/server/shared/auth/cuenta";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";

export const POST = manejar(
  { ruta: "/api/v1/auth/resend-confirmation", metodo: "POST" },
  withPolicy("E-03", (ctx) => reenviarConfirmacion(ctx)),
);
