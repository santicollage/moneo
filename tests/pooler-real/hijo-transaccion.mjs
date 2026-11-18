/* global process, URL, console, setInterval */
// F4-03d · Proceso hijo de proceso-cortado.test.ts: abre una transacción por el pooler de transacciones
// (6543), toma el bloqueo de M-4 y se queda vivo SIN hablar y SIN cerrar. El padre lo mata (o no).
// Recibe: argv[2] = actor, argv[3] = espacio; env MONEO_APP_TX_URL y M4_SQL.
import pg from "pg";

const u = new URL(process.env.MONEO_APP_TX_URL);
const c = new pg.Client({
  host: u.hostname,
  port: Number(u.port),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || "postgres",
  ssl: { rejectUnauthorized: false },
});
c.on("error", () => {}); // si la base cierra la conexión (25P03), el hijo sigue vivo hasta que el padre lo mate

await c.connect();
await c.query("BEGIN");
const r = await c.query(process.env.M4_SQL, [process.argv[2], process.argv[3]]);
console.log(r.rowCount === 1 ? "BLOQUEADO" : "SIN_FILA");
setInterval(() => {}, 1 << 30);
