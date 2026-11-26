// E-04 · `POST /auth/confirm`: `token_hash` del fragmento del enlace (F4-05-D1) → cookie de sesión.
import { confirmar } from "@/server/shared/auth/cuenta";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";
// R68 (F4-06a-D2): tope propio; Hobby da 300 s por defecto. El peor camino (E-09) ronda 17 s.
export const maxDuration = 25;

export const POST = manejar(
  { ruta: "/api/v1/auth/confirm", metodo: "POST" },
  withPolicy("E-04", (ctx) => confirmar(ctx)),
);
