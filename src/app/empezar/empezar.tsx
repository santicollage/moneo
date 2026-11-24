"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { llamar, textoDeProblema } from "../_cliente/api";
import { Aviso } from "../_cliente/campos";

type Me = {
  profile: { id: string; displayName: string; email: string };
  memberships: { spaceId: string; spaceName: string; role: "owner" | "collaborator" }[];
};

// Pantalla provisional de F4-05c: demuestra sesión de punta a punta (E-10). La experiencia real
// de "empezar" (crear espacio, invitar) llega en F5.
export function Empezar() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void llamar<Me>("/me", "GET").then((r) => {
      if (r.ok) setMe(r.datos);
      else if (r.problema.status === 401) router.replace("/entrar");
      else setError(textoDeProblema(r.problema));
    });
  }, [router]);

  async function salir(todas: boolean) {
    await llamar(todas ? "/auth/logout-all" : "/auth/logout", "POST");
    router.replace("/entrar");
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">Empezar</h1>
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {!me && !error ? <Aviso tipo="info">Cargando…</Aviso> : null}
      {me ? (
        <>
          <p className="mt-4" data-testid="identidad">
            Hola, {me.profile.displayName} ({me.profile.email})
          </p>
          <p className="mt-2 text-sm">
            {me.memberships.length === 0
              ? "Todavía no perteneces a ningún espacio."
              : `Espacios: ${me.memberships.map((m) => m.spaceName).join(", ")}`}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" className="border px-3 py-2" onClick={() => salir(false)}>
              Salir
            </button>
            <button type="button" className="border px-3 py-2" onClick={() => salir(true)}>
              Salir de todos los dispositivos
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
