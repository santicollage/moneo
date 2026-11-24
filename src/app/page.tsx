import { redirect } from "next/navigation";

// La portada real llega en F6; hoy la raíz solo lleva a la pantalla de entrada de la sesión.
export default function Inicio() {
  redirect("/empezar");
}
