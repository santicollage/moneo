import type { Metadata } from "next";
import { FormularioRegistro } from "./formulario";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function Pagina() {
  return <FormularioRegistro />;
}
