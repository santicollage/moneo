"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { llamar, textoDeProblema } from "../_cliente/api";
import { Aviso, Boton, Campo } from "../_cliente/campos";

export function FormularioEntrar() {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sinConfirmar, setSinConfirmar] = useState(false);
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setInfo(null);
    setSinConfirmar(false);
    const r = await llamar("/auth/login", "POST", { email: correo, password: clave });
    if (r.ok) {
      router.replace("/empezar");
      return;
    }
    setCargando(false);
    if (r.problema.code === "email_not_confirmed") setSinConfirmar(true);
    setError(textoDeProblema(r.problema));
  }

  async function reenviar() {
    setCargando(true);
    const r = await llamar("/auth/resend-confirmation", "POST", { email: correo });
    setCargando(false);
    if (r.ok) {
      setError(null);
      setInfo("Si el correo está registrado, te enviamos un enlace nuevo. Puede tardar un minuto.");
    } else if (r.problema.code === "too_many_attempts") {
      setError("Espera un minuto antes de pedir otro correo.");
    } else {
      setError(textoDeProblema(r.problema));
    }
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <form onSubmit={enviar} noValidate>
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
          autoComplete="current-password"
          required
          value={clave}
          onChange={(e) => setClave(e.target.value)}
        />
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        {info ? <Aviso tipo="info">{info}</Aviso> : null}
        <Boton type="submit" cargando={cargando}>
          Entrar
        </Boton>
      </form>
      {sinConfirmar ? (
        <button type="button" className="mt-3 underline" onClick={reenviar} disabled={cargando}>
          Reenviar el correo de confirmación
        </button>
      ) : null}
      <p className="mt-6 text-sm">
        <Link className="underline" href="/recuperar">
          Olvidé mi contraseña
        </Link>
        {" · "}
        <Link className="underline" href="/registro">
          Crear cuenta
        </Link>
      </p>
    </section>
  );
}
