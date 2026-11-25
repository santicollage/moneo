// F4-05c · Clave de firma ES256 DESECHABLE para el Supabase local del CI (EN-11).
// `supabase/signing_keys.json` está en .gitignore; en el equipo del autor se genera una vez con
// `supabase gen signing-key` (ver .env.example). En el CI no hay nadie que responda el «¿sobrescribir?»
// de ese comando, así que se genera aquí con el mismo formato: un arreglo de JWK privadas.
// Si el archivo ya existe, no se toca.
import { generateKeyPairSync, randomUUID } from "node:crypto";
import process from "node:process";
import { existsSync, writeFileSync } from "node:fs";

const destino = process.argv[2];
if (!destino) {
  process.stderr.write("Uso: node scripts/ci/generar-clave-firma.mjs <signing_keys.json>\n");
  process.exit(2);
}
if (existsSync(destino)) {
  process.stdout.write("La clave de firma ya existe: no se toca.\n");
  process.exit(0);
}

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = {
  ...privateKey.export({ format: "jwk" }),
  kid: randomUUID(),
  alg: "ES256",
  use: "sig",
  key_ops: ["sign", "verify"],
  ext: true,
};
writeFileSync(destino, `${JSON.stringify([jwk], null, 2)}\n`, { mode: 0o600 });
process.stdout.write("Clave de firma ES256 desechable creada.\n");
