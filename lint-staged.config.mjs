// pre-commit: solo lo rápido y solo sobre los archivos en staging.
// Las pruebas y el typecheck corren en pre-push y en CI (ADR-008).
export default {
  "*.{ts,tsx,mjs,mts}": ["prettier --write", "eslint --max-warnings=0 --no-warn-ignored"],
  "*.{json,md,yml,yaml,css}": "prettier --write",
};
