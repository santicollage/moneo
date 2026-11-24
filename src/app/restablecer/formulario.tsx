"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Contrasena, CONTRASENA_MIN_CARACTERES } from "@/contracts/auth";
import { llamar, textoDeProblema } from "../_cliente/api";
import { Aviso, Boton, Campo } from "../_cliente/campos";

// El `token_hash` viaja en el fragmento del enlace (`#token_hash=...&type=recovery`). Se lee una
// vez, se borra de la barra y se guarda SOLO en memoria del componente (no en storage).
export function FormularioRestablecer() {
  const [tokenHash, setTokenHash] = useState<string | null | undefined>(undefined);
  const [clave, setClave] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  // Strict Mode ejecuta el efecto dos veces: la segunda ya no vería el fragmento (se borró).
  const leido = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (leido.current === undefined) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const t = params.get("token_hash");
      window.history.replaceState(null, "", window.location.pathname);
      leido.current = t && params.get("type") === "recovery" ? t : null;
    }
    const valor = leido.current;
    void Promise.resolve().then(() => setTokenHash(valor));
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!Contrasena.safeParse(clave).success) {
      return setError(
        `La contraseña necesita al menos ${CONTRASENA_MIN_CARACTERES} caracteres y no más de 72 bytes.`,
      );
    }
    setCargando(true);
    const r = await llamar("/auth/reset-password", "POST", { tokenHash, password: clave });
    setCargando(false);
    if (r.ok) {
      setClave("");
      return setListo(true);
    }
    setError(textoDeProblema(r.problema));
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">Nueva contraseña</h1>
      {tokenHash === undefined ? <Aviso tipo="info">Cargando…</Aviso> : null}
      {tokenHash === null && !listo ? (
        <>
          <Aviso tipo="error">
            El enlace está incompleto o ya se usó. Pide uno nuevo desde “Olvidé mi contraseña”.
          </Aviso>
          <p className="mt-6 text-sm">
            <Link className="underline" href="/recuperar">
              Pedir otro enlace
            </Link>
          </p>
        </>
      ) : null}
      {listo ? (
        <>
          <Aviso tipo="info">Tu contraseña cambió. Entra con la nueva.</Aviso>
          <p className="mt-6">
            <Link className="underline" href="/entrar">
              Entrar
            </Link>
          </p>
        </>
      ) : null}
      {tokenHash && !listo ? (
        <form onSubmit={enviar} noValidate>
          <Campo
            etiqueta="Contraseña nueva"
            type="password"
            autoComplete="new-password"
            required
            ayuda={`Al menos ${CONTRASENA_MIN_CARACTERES} caracteres.`}
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          <Boton type="submit" cargando={cargando}>
            Guardar contraseña
          </Boton>
        </form>
      ) : null}
    </section>
  );
}
