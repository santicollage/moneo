"use client";

// Pantalla de error de la interfaz (F4-05c). `digest` es el identificador que Next deja en los
// logs del servidor; se muestra para poder buscar el fallo sin exponer detalles.
export default function PantallaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section role="alert">
      <h1 className="text-xl font-semibold">Algo salió mal</h1>
      <p className="mt-2">No pudimos mostrar esta pantalla. Puedes intentarlo de nuevo.</p>
      {error.digest ? <p className="mt-2 text-sm">Código: {error.digest}</p> : null}
      <button type="button" className="mt-4 border px-3 py-2" onClick={() => reset()}>
        Reintentar
      </button>
    </section>
  );
}
