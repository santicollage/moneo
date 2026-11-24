import type { Metadata } from "next";
import { FormularioRestablecer } from "./formulario";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default function Pagina() {
  return <FormularioRestablecer />;
}
