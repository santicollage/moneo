// E-02 · `POST /auth/register`: 202 siempre (UC-01 A1/A2). El hook S-7 decide quién se registra.
import { registrar } from "@/server/shared/auth/cuenta";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";
// R68 (F4-06a-D2): tope propio; Hobby da 300 s por defecto. El peor camino (E-09) ronda 17 s.
export const maxDuration = 25;

export const POST = manejar(
  { ruta: "/api/v1/auth/register", metodo: "POST" },
  withPolicy("E-02", (ctx) => registrar(ctx)),
);
