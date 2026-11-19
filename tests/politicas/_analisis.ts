// Análisis estático compartido por las pruebas de política (F4-04b). Sin dependencias de Next.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function archivos(dir: string, patron: RegExp): string[] {
  const salida: string[] = [];
  const recorrer = (d: string): void => {
    for (const nombre of readdirSync(d)) {
      const ruta = join(d, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (patron.test(ruta.replaceAll("\\", "/"))) salida.push(ruta);
    }
  };
  recorrer(dir);
  return salida.sort();
}

export const leer = (ruta: string): string => readFileSync(ruta, "utf8");

/** Quita comentarios para no confundir `withPolicy` en un comentario con su uso. */
export function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

export type InfoRuta = {
  /** Ids pasados a `withPolicy("E-xx", …)`. */
  politicas: string[];
  ruta: string | null;
  metodo: string | null;
  usaManejar: boolean;
};

export function analizarRouteHandler(codigo: string): InfoRuta {
  const c = sinComentarios(codigo);
  return {
    politicas: [...c.matchAll(/\bwithPolicy\(\s*["'](E-\d{2})["']/g)].map((m) => m[1]!),
    ruta: /\bruta:\s*["'`]([^"'`]+)["'`]/.exec(c)?.[1] ?? null,
    metodo: /\bmetodo:\s*["'](GET|POST|PATCH|PUT)["']/.exec(c)?.[1] ?? null,
    usaManejar: /\bmanejar\(/.test(c),
  };
}

/**
 * Funciones exportadas de un `*.repo.ts` cuyo segundo parámetro no se llama `spaceId` (EN-14).
 * Firma exigida: `(tx, spaceId, …)`. Devuelve los nombres que incumplen.
 */
export function funcionesSinSpaceId(codigo: string): string[] {
  const c = sinComentarios(codigo);
  const malas: string[] = [];
  const re = /export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\(([^)]*)\)/g;
  for (const m of c.matchAll(re)) {
    const params = m[2]!.split(",").map((p) => p.trim().split(/[:=?]/)[0]!.trim());
    if (params[1] !== "spaceId") malas.push(m[1]!);
  }
  const flecha = /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>/g;
  for (const m of c.matchAll(flecha)) {
    const params = m[2]!.split(",").map((p) => p.trim().split(/[:=?]/)[0]!.trim());
    if (params[1] !== "spaceId") malas.push(m[1]!);
  }
  return malas;
}
