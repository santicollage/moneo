import type { Metadata } from "next";
import { Confirmar } from "./confirmar";

export const metadata: Metadata = { title: "Confirmar correo" };

export default function Pagina() {
  return <Confirmar />;
}
