// E-05 · `POST /auth/login`: límites DN-2 antes de probar la contraseña; 401 genérico.
import { entrar } from "@/server/shared/auth/cuenta";
import { withPolicy } from "@/server/shared/auth/politica";
import { manejar } from "@/server/shared/http/manejar";

export const dynamic = "force-dynamic";

export const POST = manejar(
  { ruta: "/api/v1/auth/login", metodo: "POST" },
  withPolicy("E-05", (ctx) => entrar(ctx)),
);
