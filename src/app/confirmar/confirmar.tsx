"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { llamar, textoDeProblema } from "../_cliente/api";
import { Aviso } from "../_cliente/campos";

// El enlace del correo trae `#token_hash=...&type=email`. El fragmento no viaja al servidor ni a
// los logs; esta página lo lee, lo borra de la barra y lo envía por POST (E-04).
export function Confirmar() {
  const [estado, setEstado] = useState<"trabajando" | "listo" | "error">("trabajando");
  const [mensaje, setMensaje] = useState("");
  const usado = useRef(false);

  useEffect(() => {
    if (usado.current) return; // el token es de un solo uso; Strict Mode monta dos veces.
    usado.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = params.get("token_hash");
    const tipo = params.get("type");
    window.history.replaceState(null, "", window.location.pathname);
    // Todo `setState` ocurre en una continuación asíncrona, no en el cuerpo del efecto.
    const resultado =
      !tokenHash || tipo !== "email"
        ? Promise.resolve(null)
        : llamar("/auth/confirm", "POST", { tokenHash, type: "email" });
    void resultado.then((r) => {
      if (r?.ok) setEstado("listo");
      else {
        setEstado("error");
        setMensaje(
          r
            ? textoDeProblema(r.problema)
            : "El enlace está incompleto. Abre el que llegó a tu correo o pide uno nuevo.",
        );
      }
    });
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Confirmar correo</h1>
      {estado === "trabajando" ? <Aviso tipo="info">Confirmando…</Aviso> : null}
      {estado === "listo" ? (
        <>
          <Aviso tipo="info">Listo, tu correo quedó confirmado.</Aviso>
          <p className="mt-6">
            <Link className="underline" href="/entrar">
              Entrar
            </Link>
          </p>
        </>
      ) : null}
      {estado === "error" ? (
        <>
          <Aviso tipo="error">{mensaje}</Aviso>
          <p className="mt-6 text-sm">
            <Link className="underline" href="/entrar">
              Ir a entrar (ahí puedes pedir otro correo)
            </Link>
          </p>
        </>
      ) : null}
    </section>
  );
}
