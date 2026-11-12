/**
 * Política de los workflows de GitHub Actions y de Dependabot (F4-02, G3-H4, R56).
 *
 * El CI llegará a tener secretos de producción (DB_OWNER_URL en F4-03, VERCEL_TOKEN en F4-06,
 * la clave de B2 en F5-07). Una acción de terceros comprometida los leería. Estas reglas no
 * dependen de que alguien las recuerde: si un workflow las rompe, esta prueba falla, y con ella
 * `pnpm test` (pre-push y CI).
 *
 *   WF-01  toda acción fijada por SHA completo, con la versión en un comentario
 *   WF-02  nada de pull_request_target ni workflow_run
 *   WF-03  permisos mínimos: `contents: read` a nivel raíz y ningún permiso de escritura
 *   WF-04  actions/checkout siempre con persist-credentials: false
 *
 * Igual que las reglas ARQ-xx: cada regla tiene un caso que DEBE fallar sobre un texto de ejemplo.
 * Si un workflow necesita de verdad un permiso de escritura, se cambia WF-03 y su caso en el mismo
 * commit, con un ADR que diga por qué.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR_WORKFLOWS = join(process.cwd(), ".github", "workflows");
const DEPENDABOT = join(process.cwd(), ".github", "dependabot.yml");

/** Violaciones de un workflow. Lista vacía = cumple. */
function violaciones(texto: string): string[] {
  const t = texto.replace(/\r\n/g, "\n");
  const v: string[] = [];

  t.split("\n").forEach((linea, i) => {
    const n = i + 1;

    const uses = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(linea);
    if (uses) {
      const ref = uses[1] ?? "";
      const resto = uses[2] ?? "";
      if (!ref.startsWith("./")) {
        if (!/@[0-9a-f]{40}$/.test(ref)) {
          v.push(`línea ${n}: "${ref}" no está fijada por SHA completo (WF-01)`);
        } else if (!/^\s*#\s*v?\d/.test(resto)) {
          v.push(`línea ${n}: "${ref}" no lleva la versión en un comentario (WF-01)`);
        }
      }
    }

    if (/^\s*(pull_request_target|workflow_run)\s*:/.test(linea)) {
      v.push(`línea ${n}: trigger prohibido (WF-02)`);
    }

    if (/^\s*[a-z-]+:\s*write\s*$/.test(linea)) {
      v.push(`línea ${n}: permiso de escritura (WF-03)`);
    }
  });

  if (!/^permissions:\n\s+contents: read\n/m.test(t)) {
    v.push("falta `permissions:` con `contents: read` a nivel raíz (WF-03)");
  }

  // Los comentarios no cuentan: la cabecera de un workflow puede nombrar la regla.
  const sinComentarios = t
    .split("\n")
    .filter((linea) => !/^\s*#/.test(linea))
    .join("\n");
  const checkouts = (sinComentarios.match(/uses:\s*actions\/checkout@/g) ?? []).length;
  const sinCredenciales = (sinComentarios.match(/persist-credentials:\s*false/g) ?? []).length;
  if (checkouts !== sinCredenciales) {
    v.push(`hay ${checkouts} checkout y ${sinCredenciales} con persist-credentials: false (WF-04)`);
  }

  return v;
}

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

const VALIDO = `name: x
permissions:
  contents: read
jobs:
  a:
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          persist-credentials: false
`;

describe("workflows reales", () => {
  it("existen ci.yml y nightly.yml", () => {
    expect(existsSync(join(DIR_WORKFLOWS, "ci.yml"))).toBe(true);
    expect(existsSync(join(DIR_WORKFLOWS, "nightly.yml"))).toBe(true);
  });

  const archivos = existsSync(DIR_WORKFLOWS)
    ? readdirSync(DIR_WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))
    : [];

  it.each(archivos)("%s cumple WF-01 a WF-04", (archivo) => {
    expect(violaciones(readFileSync(join(DIR_WORKFLOWS, archivo), "utf8"))).toEqual([]);
  });
});

describe("las reglas fallan cuando deben", () => {
  it("el caso válido pasa", () => {
    expect(violaciones(VALIDO)).toEqual([]);
  });

  it("WF-01: acción con etiqueta en lugar de SHA", () => {
    const malo = VALIDO.replace(`@${SHA} # v7.0.1`, "@v7");
    expect(violaciones(malo).join("\n")).toContain("WF-01");
  });

  it("WF-01: SHA abreviado", () => {
    const malo = VALIDO.replace(SHA, SHA.slice(0, 7));
    expect(violaciones(malo).join("\n")).toContain("WF-01");
  });

  it("WF-01: SHA sin el comentario con la versión", () => {
    const malo = VALIDO.replace(" # v7.0.1", "");
    expect(violaciones(malo).join("\n")).toContain("WF-01");
  });

  it("WF-02: pull_request_target", () => {
    expect(violaciones(`on:\n  pull_request_target:\n${VALIDO}`).join("\n")).toContain("WF-02");
  });

  it("WF-02: workflow_run", () => {
    expect(violaciones(`on:\n  workflow_run:\n${VALIDO}`).join("\n")).toContain("WF-02");
  });

  it("WF-03: sin permissions a nivel raíz", () => {
    const malo = VALIDO.replace("permissions:\n  contents: read\n", "");
    expect(violaciones(malo).join("\n")).toContain("WF-03");
  });

  it("WF-03: permiso de escritura", () => {
    const malo = VALIDO.replace("contents: read", "contents: read\n  id-token: write");
    expect(violaciones(malo).join("\n")).toContain("WF-03");
  });

  it("WF-04: un comentario que nombra persist-credentials no sustituye al paso", () => {
    const malo = VALIDO.replace(
      "        with:\n          persist-credentials: false\n",
      "        # persist-credentials: false\n",
    );
    expect(violaciones(malo).join("\n")).toContain("WF-04");
  });

  it("WF-04: checkout sin persist-credentials: false", () => {
    const malo = VALIDO.replace("        with:\n          persist-credentials: false\n", "");
    expect(violaciones(malo).join("\n")).toContain("WF-04");
  });
});

describe("dependabot.yml", () => {
  const texto = existsSync(DEPENDABOT) ? readFileSync(DEPENDABOT, "utf8") : "";

  it("cubre npm y las acciones de GitHub (R56)", () => {
    expect(texto).toMatch(/package-ecosystem:\s*npm/);
    expect(texto).toMatch(/package-ecosystem:\s*github-actions/);
  });

  it("usa cooldown y ningún grupo con comodín (un grupo * anula el cooldown)", () => {
    expect(texto).toMatch(/cooldown:/);
    expect(texto).not.toMatch(/^\s*groups:/m);
  });
});
