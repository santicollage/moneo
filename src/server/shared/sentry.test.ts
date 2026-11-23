// F4-04c · «Hecho cuando»: lo que saldría hacia Sentry pasa la prueba sin datos (RNF-PRI-01, O-7, R53).
// Se prueba el envelope EXACTO que se mandaría (bytes del cuerpo), pasando por `manejar()`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ConfigSentry } from "./config";
import { ErrorApi } from "./http/errores";
import { manejar, type Manejador } from "./http/manejar";
import { crearLogger } from "./log";
import {
  CLIENTE,
  construirEvento,
  crearReportero,
  marcosDe,
  MAXIMO_MARCOS,
  type Enviar,
} from "./sentry";

const ORIGEN = "http://localhost:3000";
const ID = "3f2b1c9e-8a7d-4b6c-9e5f-1a2b3c4d5e6f";
const DESTINO: ConfigSentry = {
  endpoint: "https://o4501.ingest.us.sentry.io/api/4507001/envelope/",
  clavePublica: "abc123publica",
  dsn: "https://abc123publica@o4501.ingest.us.sentry.io/4507001",
};
const AHORA = Date.UTC(2026, 10, 19, 15, 7, 30, 250);

const CORREO = "ana.marcador@ejemplo.co";
const MONTO = "987654321.12";
const NOTA = "MARCADOR-NOTA-zx81";
const SESION = "MARCADOR-SESION-q7m2";
const RUTA_REAL = "/api/v1/spaces/1d6f0b8e-5c4a-4f2e-9b7d-0a1b2c3d4e5f/movements";
const MARCADORES = [CORREO, MONTO, NOTA, SESION, RUTA_REAL, "1d6f0b8e-5c4a-4f2e-9b7d-0a1b2c3d4e5f"];

function capturador() {
  const enviados: { url: string; init: RequestInit }[] = [];
  const enviar: Enviar = async (url, init) => {
    enviados.push({ url, init });
    return new Response(null, { status: 200 });
  };
  return { enviar, enviados };
}

function reportero(enviar: Enviar, version?: string) {
  return crearReportero({
    destino: DESTINO,
    contexto: { entorno: "production", version },
    enviar,
    ahora: () => AHORA,
    nuevoId: () => ID,
  });
}

function montar(fn: Manejador, enviar: Enviar) {
  return manejar({ ruta: "/api/v1/spaces/:spaceId/movements", metodo: "POST" }, fn, {
    appOrigin: () => ORIGEN,
    log: crearLogger(() => {}),
    nuevoId: () => ID,
    reportar: reportero(enviar),
  });
}

const peticion = () =>
  new Request(`${ORIGEN}${RUTA_REAL}`, {
    method: "POST",
    headers: {
      origin: ORIGEN,
      "content-type": "application/json",
      cookie: `sb-access-token=${SESION}`,
      authorization: `Bearer ${SESION}`,
    },
    body: JSON.stringify({ amount: MONTO, note: NOTA, email: CORREO }),
  });

/** Errores con datos en todos los lugares donde una herramienta los suele leer. */
const errores: [string, () => unknown][] = [
  ["mensaje con datos", () => new Error(`fallo con ${MONTO}, ${NOTA} y ${CORREO}`)],
  [
    "Postgres por Prisma (23505 con el valor en el detalle)",
    () =>
      Object.assign(new Error(`Unique constraint failed: Key (email)=(${CORREO})`), {
        code: "P2010",
        meta: {
          driverAdapterError: {
            cause: { originalCode: "23505", kind: "postgres", message: NOTA, detail: CORREO },
          },
        },
      }),
  ],
  [
    "causa encadenada y propiedades",
    () =>
      Object.assign(new TypeError("x", { cause: new Error(NOTA) }), {
        usuario: CORREO,
        cuerpo: { amount: MONTO },
      }),
  ],
  [
    "mensaje que imita un marco de la pila",
    () => new Error(`hola\n    at ${NOTA} (src/${CORREO}:1:2)\n    at evil (${SESION}.ts:3:4)`),
  ],
  ["un valor que no es Error", () => ({ message: NOTA, email: CORREO })],
  ["un string", () => `${CORREO} ${MONTO}`],
];

describe("RNF-PRI-01 extendido a Sentry (F4-04c)", () => {
  it.each(errores)("%s: el envelope no contiene ningún dato", async (_n, crear) => {
    const { enviar, enviados } = capturador();
    const res = await montar(async (ctx) => {
      await ctx.leerJson();
      throw crear();
    }, enviar)(peticion());
    expect(res.status).toBe(500);
    expect(enviados).toHaveLength(1);
    const cuerpo = String(enviados[0]!.init.body);
    for (const m of MARCADORES) expect(cuerpo).not.toContain(m);
    // Ni las cabeceras de la petición.
    const cabeceras = JSON.stringify(enviados[0]!.init.headers);
    expect(cabeceras).not.toContain(SESION);
  });

  it("el evento solo tiene las claves de la lista permitida", async () => {
    const { enviar, enviados } = capturador();
    await montar(async () => {
      throw new Error(NOTA);
    }, enviar)(peticion());
    const [cabecera, item, evento, resto] = String(enviados[0]!.init.body).split("\n");
    expect(resto).toBe("");
    expect(JSON.parse(cabecera!)).toEqual({
      event_id: ID.replaceAll("-", ""),
      sent_at: "2026-11-19T15:07:30.250Z",
      dsn: DESTINO.dsn,
    });
    expect(JSON.parse(item!)).toEqual({ type: "event" });
    const e = JSON.parse(evento!) as Record<string, unknown>;
    expect(Object.keys(e).sort()).toEqual(
      [
        "environment",
        "event_id",
        "exception",
        "fingerprint",
        "level",
        "platform",
        "tags",
        "timestamp",
      ].sort(),
    );
    expect(e.tags).toEqual({
      route: "/api/v1/spaces/:spaceId/movements",
      method: "POST",
      requestId: ID,
      errorCode: "Error",
    });
    expect(e.fingerprint).toEqual(["Error", "/api/v1/spaces/:spaceId/movements"]);
    expect(e.timestamp).toBe(AHORA / 1000);
    const valores = (e.exception as { values: Record<string, unknown>[] }).values;
    expect(valores).toHaveLength(1);
    expect(Object.keys(valores[0]!).sort()).toEqual(["stacktrace", "type"]);
    expect(valores[0]!.type).toBe("Error");
    for (const marco of (valores[0]!.stacktrace as { frames: Record<string, unknown>[] }).frames) {
      expect(
        Object.keys(marco).every((k) =>
          ["filename", "function", "lineno", "colno", "in_app"].includes(k),
        ),
      ).toBe(true);
      expect(String(marco.filename)).not.toMatch(/^\/|^[A-Za-z]:|\\/); // nunca ruta absoluta
    }
  });

  it("protocolo: POST al endpoint de envelopes con X-Sentry-Auth y content-type de envelope", async () => {
    const { enviar, enviados } = capturador();
    await reportero(enviar)(new Error("x"), {
      requestId: ID,
      ruta: "/api/v1/health",
      errorCode: "Error",
    });
    expect(enviados[0]!.url).toBe(DESTINO.endpoint);
    expect(enviados[0]!.init.method).toBe("POST");
    expect(enviados[0]!.init.headers).toEqual({
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=${CLIENTE}, sentry_key=abc123publica`,
    });
    expect(enviados[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("release solo con un SHA; datos inválidos en las etiquetas se descartan", () => {
    const e = construirEvento(
      new Error("x"),
      { requestId: CORREO, ruta: RUTA_REAL, errorCode: `Key (email)=(${CORREO})` },
      { entorno: "preview", version: "0123456789abcdef0123456789abcdef01234567" },
      AHORA,
      () => ID,
    );
    expect(e.release).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(e.environment).toBe("preview");
    // `filtrar` no deja pasar ni el requestId que no es UUID, ni la ruta real, ni un errorCode que es mensaje.
    expect(e.tags).toEqual({ dropped: "3" });
    expect(e.exception.values[0].type).toBe("unknown");
    expect(JSON.stringify(e)).not.toContain(CORREO);
  });

  it("errores esperados (ErrorApi) y 503 busy no se reportan", async () => {
    const { enviar, enviados } = capturador();
    await montar(async () => {
      throw new ErrorApi("not_found");
    }, enviar)(peticion());
    await montar(async () => {
      throw Object.assign(new Error("lock"), { code: "55P03" });
    }, enviar)(peticion());
    expect(enviados).toHaveLength(0);
  });

  it("Sentry caído, lento o que lanza no cambia la respuesta ni lanza", async () => {
    const lanza: Enviar = async () => {
      throw new Error("red");
    };
    const lento: Enviar = (_u, init) =>
      new Promise((_r, rechazar) =>
        init.signal?.addEventListener("abort", () => rechazar(new Error("abort"))),
      );
    for (const enviar of [lanza, lento]) {
      const h = manejar(
        { ruta: "/api/v1/health", metodo: "GET" },
        async () => {
          throw new Error("x");
        },
        {
          log: crearLogger(() => {}),
          reportar: crearReportero({
            destino: DESTINO,
            contexto: { entorno: "local", version: undefined },
            enviar,
            topeMs: 50,
          }),
        },
      );
      const t0 = Date.now();
      expect((await h(new Request(`${ORIGEN}/api/v1/health`))).status).toBe(500);
      expect(Date.now() - t0).toBeLessThan(1_000);
    }
  });

  it("marcos: rutas relativas, sin el usuario del equipo, a lo sumo 30, el más antiguo primero", () => {
    const err = new Error("m");
    err.stack = [
      "Error: m",
      "    at manejar (C:\\Users\\santi\\Escritorio\\Proyectos\\moneo\\src\\server\\shared\\http\\manejar.ts:10:5)",
      "    at async Promise.all (index 0)",
      "    at file:///var/task/.next/server/app/api/v1/health/route.js:1:2",
      "    at Object.<anonymous> (/home/vercel/node_modules/pg/lib/client.js:3:4)",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n");
    expect(marcosDe(err)).toEqual([
      { filename: "node:internal/process/task_queues", lineno: 95, colno: 5, in_app: false },
      {
        filename: "node_modules/pg/lib/client.js",
        function: "Object.<anonymous>",
        lineno: 3,
        colno: 4,
        in_app: false,
      },
      { filename: ".next/server/app/api/v1/health/route.js", lineno: 1, colno: 2, in_app: true },
      {
        filename: "src/server/shared/http/manejar.ts",
        function: "manejar",
        lineno: 10,
        colno: 5,
        in_app: true,
      },
    ]);
    const larga = new Error("l");
    larga.stack = [
      "Error: l",
      ...Array.from({ length: 50 }, (_, i) => `    at f${i} (src/a.ts:${i + 1}:1)`),
    ].join("\n");
    expect(marcosDe(larga)).toHaveLength(MAXIMO_MARCOS);
    // Mensaje cambiado después de crear el error: el marco falso del mensaje nunca sale.
    const cambiado = new Error("original");
    cambiado.message = `${NOTA}\n    at ${NOTA} (src/x.ts:1:1)`;
    expect(JSON.stringify(marcosDe(cambiado))).not.toContain(NOTA);
    // Y si la pila ya no empieza con «Nombre: mensaje», no se manda ningún marco.
    const raro = new Error("a");
    raro.stack = `Otro: b\n    at ${NOTA} (src/x.ts:1:1)`;
    expect(marcosDe(raro)).toEqual([]);
  });

  it("propiedad: ningún texto metido en el mensaje, la causa o las propiedades sale en el evento", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 6, maxLength: 60 }).filter((s) => /[A-Za-z0-9]{6}/.test(s)),
        (dato) => {
          // El marcador debe ser algo que no aparezca por casualidad en el evento (nombres de archivo, etc.).
          const marca = `ZQX${dato}`;
          const err = Object.assign(new Error(`${marca}\n    at ${marca} (src/${marca}.ts:1:1)`), {
            cause: marca,
            detail: marca,
            meta: { driverAdapterError: { cause: { message: marca } } },
          });
          const e = construirEvento(
            err,
            { requestId: ID, ruta: "/api/v1/health", errorCode: "Error" },
            { entorno: "local", version: undefined },
            AHORA,
            () => ID,
          );
          return !JSON.stringify(e).includes(marca);
        },
      ),
      { numRuns: 300 },
    );
  });
});
