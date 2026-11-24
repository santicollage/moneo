// E-02 · `POST /auth/register`: 202 siempre (UC-01 A1/A2). El hook S-7 decide quién se registra.
import { registrar } from "@/server/shared/auth/cuenta";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";

export const POST = manejar(
  { ruta: "/api/v1/auth/register", metodo: "POST" },
  withPolicy("E-02", (ctx) => registrar(ctx)),
);
