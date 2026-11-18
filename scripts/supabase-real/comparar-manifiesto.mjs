// Moneo · F4-03c · Compara los permisos REALES de moneo_app (salida de manifiesto-real.sql) con
// prisma/permisos-moneo_app.json, con la misma normalización que tests/integration/db/manifiesto.test.ts.
// Uso: node scripts/supabase-real/comparar-manifiesto.mjs <archivo de permisos reales>
// Sale con código 1 si hay diferencias y las lista por tabla.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

// Sin globals de Node en el lint de scripts/: se importa process y se escribe por stdout/stderr.
const escribir = (texto) => process.stdout.write(`${texto}\n`);

const archivoReal = process.argv[2];
if (!archivoReal) {
  process.stderr.write(
    "Uso: node scripts/supabase-real/comparar-manifiesto.mjs <permisos-reales.json>\n",
  );
  process.exit(2);
}

const leer = (ruta) => JSON.parse(readFileSync(ruta, "utf8").replace(/^\uFEFF/, ""));
const esperado = leer(join(process.cwd(), "prisma", "permisos-moneo_app.json"));
const real = leer(archivoReal);

function normalizar(tablas) {
  const salida = {};
  for (const nombre of Object.keys(tablas).sort()) {
    const e = tablas[nombre];
    const columnas = {};
    for (const priv of Object.keys(e.columnas).sort()) {
      const cols = e.columnas[priv];
      if (cols.length > 0) columnas[priv] = [...cols].sort();
    }
    salida[nombre] = { tabla: [...e.tabla].sort(), columnas };
  }
  return salida;
}

const a = normalizar(esperado.tablas);
const b = normalizar(real.tablas);
const diferencias = [];
if (esperado.rol !== real.rol || esperado.esquema !== real.esquema) {
  diferencias.push(
    `rol/esquema: esperado ${esperado.rol}/${esperado.esquema}, real ${real.rol}/${real.esquema}`,
  );
}
for (const t of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
  if (!(t in b)) diferencias.push(`${t}: está en el manifiesto y no existe en la base`);
  else if (!(t in a)) diferencias.push(`${t}: existe en la base y no está en el manifiesto`);
  else if (JSON.stringify(a[t]) !== JSON.stringify(b[t])) {
    diferencias.push(
      `${t}:\n    esperado ${JSON.stringify(a[t])}\n    real     ${JSON.stringify(b[t])}`,
    );
  }
}

if (diferencias.length > 0) {
  escribir(`manifiesto: FALLA (${diferencias.length} diferencias)`);
  for (const d of diferencias) escribir(`  - ${d}`);
  process.exit(1);
}
escribir(
  `manifiesto: ok (${Object.keys(a).length} relaciones, idénticas a prisma/permisos-moneo_app.json)`,
);
