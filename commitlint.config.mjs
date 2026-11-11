// Conventional Commits (ADR-015 D4).
// Tipos: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Los mensajes van en español y el asunto puede empezar con una sigla (ESLint, ADR, CI).
    "subject-case": [0],
    // Las líneas de pie (Co-Authored-By, enlaces) y los cuerpos con URL no deben romper el commit.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
