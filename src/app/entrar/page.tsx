import type { Metadata } from "next";
import { FormularioEntrar } from "./formulario";

export const metadata: Metadata = { title: "Entrar" };

export default function Pagina() {
  return <FormularioEntrar />;
}
