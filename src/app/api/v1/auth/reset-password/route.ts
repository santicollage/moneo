// E-09 · `POST /auth/reset-password`: sesión de recuperación de ≤ 15 min (EN-10).
import { restablecer } from "@/server/shared/auth/cuenta";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";

export const POST = manejar(
  { ruta: "/api/v1/auth/reset-password", metodo: "POST" },
  withPolicy("E-09", (ctx) => restablecer(ctx)),
);
