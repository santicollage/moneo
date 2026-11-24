"use client";

import { useId } from "react";

export function Campo({
  etiqueta,
  ayuda,
  ...props
}: { etiqueta: string; ayuda?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        className="mt-1 w-full border px-3 py-2"
        {...props}
      />
      {ayuda ? (
        <p id={`${id}-ayuda`} className="mt-1 text-sm">
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: "error" | "info"; children: React.ReactNode }) {
  return (
    <p role={tipo === "error" ? "alert" : "status"} className="mt-4 border px-3 py-2">
      {children}
    </p>
  );
}

export function Boton({
  cargando,
  children,
  ...props
}: { cargando?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="mt-6 w-full border px-3 py-2 font-medium disabled:opacity-60"
      disabled={cargando || props.disabled}
      {...props}
    >
      {cargando ? "Un momento…" : children}
    </button>
  );
}
