"use client";

import Link from "next/link";
import { useState } from "react";
import { llamar, textoDeProblema } from "../_cliente/api";
import { Aviso, Boton, Campo } from "../_cliente/campos";

export function FormularioRecuperar() {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [correo, setCorreo] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const r = await llamar("/auth/recover", "POST", { email: correo });
    setCargando(false);
    if (r.ok) setEnviado(true);
    else setError(textoDeProblema(r.problema));
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">Recuperar contraseña</h1>
      {enviado ? (
        <Aviso tipo="info">
          Si el correo está registrado, te enviamos un enlace para elegir una contraseña nueva.
        </Aviso>
      ) : (
        <form onSubmit={enviar} noValidate>
          <Campo
            etiqueta="Correo"
            type="email"
            autoComplete="email"
            required
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          <Boton type="submit" cargando={cargando}>
            Enviar enlace
          </Boton>
        </form>
      )}
      <p className="mt-6 text-sm">
        <Link className="underline" href="/entrar">
          Volver a entrar
        </Link>
      </p>
    </section>
  );
}
