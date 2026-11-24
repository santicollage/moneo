"use client";

import Link from "next/link";
import { useState } from "react";
import { Contrasena, CONTRASENA_MIN_CARACTERES } from "@/contracts/auth";
import { llamar, textoDeProblema } from "../_cliente/api";
import { Aviso, Boton, Campo } from "../_cliente/campos";

export function FormularioRegistro() {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return setError("Escribe cómo quieres que te llamemos.");
    if (!Contrasena.safeParse(clave).success) {
      return setError(
        `La contraseña necesita al menos ${CONTRASENA_MIN_CARACTERES} caracteres y no más de 72 bytes.`,
      );
    }
    setCargando(true);
    const r = await llamar("/auth/register", "POST", {
      email: correo,
      password: clave,
      displayName: nombre,
    });
    setCargando(false);
    if (r.ok) return setEnviado(true);
    setError(textoDeProblema(r.problema));
  }

  if (enviado) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Revisa tu correo</h1>
        <Aviso tipo="info">
          Si el correo puede registrarse, te enviamos un enlace para confirmarlo. Si no lo ves en un
          par de minutos, revisa spam.
        </Aviso>
        <p className="mt-6 text-sm">
          <Link className="underline" href="/entrar">
            Ir a entrar
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">Crear cuenta</h1>
      <p className="mt-2 text-sm">
        Moneo está en acceso cerrado: solo pueden registrarse correos autorizados.
      </p>
      <form onSubmit={enviar} noValidate>
        <Campo
          etiqueta="Nombre"
          autoComplete="name"
          maxLength={60}
          required
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        <Campo
          etiqueta="Correo"
          type="email"
          autoComplete="email"
          required
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
        />
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="new-password"
          required
          ayuda={`Al menos ${CONTRASENA_MIN_CARACTERES} caracteres. Una frase larga es mejor que una palabra rara.`}
          value={clave}
          onChange={(e) => setClave(e.target.value)}
        />
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        <Boton type="submit" cargando={cargando}>
          Crear cuenta
        </Boton>
      </form>
      <p className="mt-6 text-sm">
        <Link className="underline" href="/entrar">
          Ya tengo cuenta
        </Link>
      </p>
    </section>
  );
}
