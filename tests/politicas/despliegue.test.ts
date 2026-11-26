/**
 * Política del despliegue (F4-06a, O-5, D-07, R68).
 *
 *   DEP-01  toda ruta de `src/app/api` declara `export const maxDuration = 25;` (literal: Next solo
 *           lee la configuración de segmento si es estática). Hobby da 300 s por defecto y una
 *           petición colgada retendría una conexión del pool 5 min (F4-06a-D2).
 *   DEP-02  `vercel.json`: funciones en `iad1` (DN-7, junto a Supabase `us-east-1`) y despliegues
 *           automáticos de Git apagados: solo despliega el pipeline (D-07).
 *   DEP-03  ci.yml despliega solo en un push a `main`, después de `ci-ok`, y producción solo
 *           después de staging.
 *   DEP-04  desplegar.yml migra antes de desplegar, despliega con `--skip-domain`, prueba el humo
 *           antes de promover y genera el cliente de Prisma con una URL de relleno (R65).
 *
 * Igual que WF-xx y ARQ-xx: cada regla tiene un caso que DEBE fallar sobre un texto de ejemplo.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const TOPE = "export const maxDuration = 25;";

function rutasApi(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return rutasApi(p);
    return n === "route.ts" ? [p] : [];
  });
}

/** DEP-01 */
function violacionesRuta(texto: string): string[] {
  return texto.split(/\r?\n/).some((l) => l.trim() === TOPE) ? [] : [`falta \`${TOPE}\` (DEP-01)`];
}

/** DEP-02 */
function violacionesVercel(texto: string): string[] {
  const v: string[] = [];
  const j = JSON.parse(texto) as { regions?: unknown; git?: { deploymentEnabled?: unknown } };
  if (JSON.stringify(j.regions) !== JSON.stringify(["iad1"]))
    v.push("regions debe ser [iad1] (DEP-02)");
  if (j.git?.deploymentEnabled !== false) v.push("git.deploymentEnabled debe ser false (DEP-02)");
  return v;
}

/** Bloque de un job de primer nivel de un workflow (desde `  nombre:` hasta el siguiente job). */
function job(texto: string, nombre: string): string {
  const t = texto.replace(/\r\n/g, "\n");
  const i = t.indexOf(`\n  ${nombre}:\n`);
  if (i < 0) return "";
  const resto = t.slice(i + 1);
  const fin = resto.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
  return fin < 0 ? resto : resto.slice(0, fin + 1);
}

const SOLO_MAIN = "if: github.event_name == 'push' && github.ref == 'refs/heads/main'";

/** DEP-03 */
function violacionesCi(texto: string): string[] {
  const v: string[] = [];
  const staging = job(texto, "desplegar-staging");
  const prod = job(texto, "desplegar-produccion");
  if (!staging || !prod)
    return ["faltan los jobs desplegar-staging y desplegar-produccion (DEP-03)"];
  for (const [nombre, b] of [
    ["desplegar-staging", staging],
    ["desplegar-produccion", prod],
  ] as const) {
    if (!b.includes(SOLO_MAIN)) v.push(`${nombre}: no está limitado a push en main (DEP-03)`);
    if (!b.includes("uses: ./.github/workflows/desplegar.yml")) {
      v.push(`${nombre}: no usa desplegar.yml (DEP-03)`);
    }
    if (/secrets:\s*inherit/.test(b))
      v.push(`${nombre}: secrets: inherit pasa secretos de más (DEP-03)`);
  }
  if (!/needs:\s*\[ci-ok\]/.test(staging))
    v.push("desplegar-staging: debe esperar a ci-ok (DEP-03)");
  if (!/entorno:\s*staging\b/.test(staging))
    v.push("desplegar-staging: entorno debe ser staging (DEP-03)");
  if (!/needs:\s*\[desplegar-staging\]/.test(prod)) {
    v.push("desplegar-produccion: debe esperar a desplegar-staging (DEP-03)");
  }
  if (!/entorno:\s*production\b/.test(prod)) {
    v.push("desplegar-produccion: entorno debe ser production (DEP-03)");
  }
  return v;
}

/** DEP-04 */
function violacionesDesplegar(texto: string): string[] {
  const v: string[] = [];
  const pos = (s: string) => texto.indexOf(s);
  const migrar = pos("prisma migrate deploy");
  const desplegar = pos("vercel deploy --prebuilt --prod --skip-domain");
  const humo = pos("scripts/despliegue/humo.sh");
  const promover = pos("vercel promote");
  if (migrar < 0) v.push("no corre prisma migrate deploy (DEP-04)");
  if (desplegar < 0) v.push("no despliega con --prebuilt --prod --skip-domain (DEP-04)");
  if (humo < 0 || promover < 0) v.push("falta el humo o la promoción (DEP-04)");
  if (migrar >= 0 && desplegar >= 0 && migrar > desplegar)
    v.push("migra después de desplegar (DEP-04)");
  if (humo >= 0 && promover >= 0 && humo > promover) v.push("promueve antes del humo (DEP-04)");
  if (!/name:\s*\$\{\{\s*inputs\.entorno\s*\}\}/.test(texto)) {
    v.push("el job no usa el environment del entorno (DEP-04)");
  }
  const generar = texto.indexOf("prisma generate");
  const tramo = generar < 0 ? "" : texto.slice(generar, generar + 200);
  if (generar < 0 || !tramo.includes("postgresql://x:x@localhost:5432/x")) {
    v.push("prisma generate sin URL de relleno (R65, DEP-04)");
  }
  return v;
}

describe("despliegue real", () => {
  const rutas = rutasApi(join(RAIZ, "src", "app", "api"));

  it("hay rutas de la API", () => {
    expect(rutas.length).toBeGreaterThan(0);
  });

  it.each(rutas.map((r) => [r.slice(RAIZ.length + 1)]))(
    "%s declara su maxDuration (DEP-01)",
    (r) => {
      expect(violacionesRuta(readFileSync(join(RAIZ, r), "utf8"))).toEqual([]);
    },
  );

  it("vercel.json cumple DEP-02", () => {
    expect(violacionesVercel(readFileSync(join(RAIZ, "vercel.json"), "utf8"))).toEqual([]);
  });

  it("ci.yml cumple DEP-03", () => {
    expect(
      violacionesCi(readFileSync(join(RAIZ, ".github", "workflows", "ci.yml"), "utf8")),
    ).toEqual([]);
  });

  it("desplegar.yml cumple DEP-04", () => {
    const p = join(RAIZ, ".github", "workflows", "desplegar.yml");
    expect(existsSync(p)).toBe(true);
    expect(violacionesDesplegar(readFileSync(p, "utf8"))).toEqual([]);
  });
});

describe("las reglas fallan cuando deben", () => {
  it("DEP-01: ruta sin maxDuration o con otro valor", () => {
    expect(violacionesRuta('export const dynamic = "force-dynamic";\n')).not.toEqual([]);
    expect(violacionesRuta("export const maxDuration = 300;\n")).not.toEqual([]);
    expect(violacionesRuta(`// ${TOPE}\n`)).not.toEqual([]);
    expect(violacionesRuta(`${TOPE}\n`)).toEqual([]);
  });

  it("DEP-02: otra región o Git encendido", () => {
    expect(violacionesVercel('{"regions":["gru1"],"git":{"deploymentEnabled":false}}')).not.toEqual(
      [],
    );
    expect(violacionesVercel('{"regions":["iad1"]}')).not.toEqual([]);
    expect(violacionesVercel('{"regions":["iad1"],"git":{"deploymentEnabled":false}}')).toEqual([]);
  });

  const CI = `jobs:
  ci-ok:
    runs-on: x
  desplegar-staging:
    ${SOLO_MAIN}
    needs: [ci-ok]
    uses: ./.github/workflows/desplegar.yml
    with:
      entorno: staging

  desplegar-produccion:
    ${SOLO_MAIN}
    needs: [desplegar-staging]
    uses: ./.github/workflows/desplegar.yml
    with:
      entorno: production
`;

  it("DEP-03: el caso válido pasa", () => {
    expect(violacionesCi(CI)).toEqual([]);
  });

  it("DEP-03: despliega también en un PR", () => {
    expect(violacionesCi(CI.replace(SOLO_MAIN, "if: always()"))).not.toEqual([]);
  });

  it("DEP-03: staging no espera a ci-ok", () => {
    expect(violacionesCi(CI.replace("needs: [ci-ok]", "needs: [verificar]"))).not.toEqual([]);
  });

  it("DEP-03: producción no espera a staging", () => {
    expect(violacionesCi(CI.replace("needs: [desplegar-staging]", "needs: [ci-ok]"))).not.toEqual(
      [],
    );
  });

  it("DEP-03: secrets: inherit", () => {
    expect(
      violacionesCi(
        CI.replace("entorno: production\n", "entorno: production\n    secrets: inherit\n"),
      ),
    ).not.toEqual([]);
  });

  const DESPLEGAR = `jobs:
  desplegar:
    environment:
      name: \${{ inputs.entorno }}
    steps:
      - run: pnpm exec prisma migrate deploy
      - run: pnpm exec prisma generate --no-hints
        env:
          DB_OWNER_URL: postgresql://x:x@localhost:5432/x
      - run: vercel deploy --prebuilt --prod --skip-domain
      - run: scripts/despliegue/humo.sh "\${URL}"
      - run: vercel promote "\${URL}"
`;

  it("DEP-04: el caso válido pasa", () => {
    expect(violacionesDesplegar(DESPLEGAR)).toEqual([]);
  });

  it("DEP-04: despliega sin --skip-domain", () => {
    expect(violacionesDesplegar(DESPLEGAR.replace(" --skip-domain", ""))).not.toEqual([]);
  });

  it("DEP-04: migra después de desplegar", () => {
    const malo = DESPLEGAR.replace("      - run: pnpm exec prisma migrate deploy\n", "").replace(
      "      - run: scripts/",
      "      - run: pnpm exec prisma migrate deploy\n      - run: scripts/",
    );
    expect(violacionesDesplegar(malo)).not.toEqual([]);
  });

  it("DEP-04: promueve antes del humo", () => {
    const malo = DESPLEGAR.replace(
      '      - run: scripts/despliegue/humo.sh "${URL}"\n      - run: vercel promote "${URL}"\n',
      '      - run: vercel promote "${URL}"\n      - run: scripts/despliegue/humo.sh "${URL}"\n',
    );
    expect(violacionesDesplegar(malo)).not.toEqual([]);
  });

  it("DEP-04: generate con la URL real", () => {
    const malo = DESPLEGAR.replace(
      "postgresql://x:x@localhost:5432/x",
      "${{ secrets.DB_OWNER_URL }}",
    );
    expect(violacionesDesplegar(malo)).not.toEqual([]);
  });
});
