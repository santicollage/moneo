/**
 * Ninguna variable pública de Supabase (F4-02, RNF-SEG-10, O-2).
 *
 * Los datos financieros solo se acceden desde el servidor y el navegador nunca usa el cliente de
 * Supabase (ADR-003, ADR-010). En Next.js, toda variable que empiece por `NEXT_PUBLIC_` se
 * incrusta en el JavaScript que baja el navegador. Una variable `NEXT_PUBLIC_…SUPABASE…` es el
 * primer paso para saltarse esa regla, así que si aparece en cualquier archivo del repositorio,
 * esta prueba falla.
 *
 * La URL y la clave pública de Supabase viven en SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY, sin el
 * prefijo, y solo las lee el servidor (docs de F3-06 §2).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const OMITIR = new Set([".git", "node_modules", ".next", "coverage", "out", "build"]);
const OMITIR_ARCHIVOS = new Set(["pnpm-lock.yaml"]);
const MAX_BYTES = 1_000_000;

/** `true` si el texto declara o usa una variable pública cuyo nombre contiene SUPABASE. */
function usaSupabasePublico(texto: string): boolean {
  return /NEXT_PUBLIC_[A-Z0-9_]*SUPABASE/.test(texto);
}

function* archivos(dir: string): Generator<string> {
  for (const nombre of readdirSync(dir)) {
    if (OMITIR.has(nombre) || OMITIR_ARCHIVOS.has(nombre)) continue;
    const ruta = join(dir, nombre);
    const info = statSync(ruta);
    if (info.isDirectory()) yield* archivos(ruta);
    else if (info.size <= MAX_BYTES) yield ruta;
  }
}

describe("sin variables públicas de Supabase", () => {
  it("el detector falla cuando debe (el texto de ejemplo se arma por partes)", () => {
    const nombre = "NEXT_PUBLIC_" + "SUPABASE_URL";
    expect(usaSupabasePublico(`${nombre}=https://x.supabase.co`)).toBe(true);
    expect(usaSupabasePublico("NEXT_PUBLIC_" + "APP_" + "SUPABASE_KEY")).toBe(true);
  });

  it("el detector deja pasar lo permitido", () => {
    expect(usaSupabasePublico("SUPABASE_URL=https://x.supabase.co")).toBe(false);
    expect(usaSupabasePublico("NEXT_PUBLIC_APP_NAME=Moneo")).toBe(false);
  });

  it("ningún archivo del repositorio la declara ni la usa", () => {
    const culpables: string[] = [];
    for (const ruta of archivos(RAIZ)) {
      const contenido = readFileSync(ruta);
      if (contenido.includes(0)) continue; // binario
      if (usaSupabasePublico(contenido.toString("utf8"))) culpables.push(relative(RAIZ, ruta));
    }
    expect(culpables).toEqual([]);
  });
});
