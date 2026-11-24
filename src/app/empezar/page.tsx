import type { Metadata } from "next";
import { Empezar } from "./empezar";

export const metadata: Metadata = { title: "Empezar" };

export default function Pagina() {
  return <Empezar />;
}
