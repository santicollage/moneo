import { describe, expect, it } from "vitest";
import { clasificar, ErrorApi } from "./errores";

/** Forma real de Prisma 7 + adapter-pg ante un error de Postgres (leída en el runtime 7.10.1). */
function prismaConSqlstate(code: "P2010" | "P2039", sqlstate: string) {
  return Object.assign(new Error(`Raw query failed. Code: \`${sqlstate}\`. Message: \`secreto\``), {
    name: "PrismaClientKnownRequestError",
    code,
    meta: { driverAdapterError: { cause: { originalCode: sqlstate, kind: "postgres" } } },
  });
}

describe("R68 traducción de errores", () => {
  it.each(["55P03", "57014", "25P03", "40001", "40P01", "53300", "57P01"])(
    "SQLSTATE %s por Prisma → busy",
    (s) => {
      expect(clasificar(prismaConSqlstate("P2010", s))).toMatchObject({
        codigo: "busy",
        errorCode: s,
      });
      expect(clasificar(prismaConSqlstate("P2039", s)).codigo).toBe("busy");
    },
  );

  it("SQLSTATE directo de pg → busy", () => {
    expect(clasificar(Object.assign(new Error("x"), { code: "55P03" })).codigo).toBe("busy");
  });

  it("P2028 (timeout o maxWait) y P2034 → busy", () => {
    for (const code of ["P2028", "P2034"]) {
      expect(clasificar(Object.assign(new Error("x"), { code })).codigo).toBe("busy");
    }
  });

  it("conexión cerrada por el adaptador → busy", () => {
    const e = Object.assign(new Error("x"), {
      code: "P2010",
      meta: { driverAdapterError: { cause: { kind: "ConnectionClosed" } } },
    });
    expect(clasificar(e).codigo).toBe("busy");
  });

  it.each([
    "Client has encountered a connection error and is not queryable",
    "Connection terminated unexpectedly",
    "Connection terminated",
    "Client was closed and is not queryable",
  ])("pg sin código tras perder la conexión («%s») → busy, con errorCode connection_lost", (m) => {
    expect(clasificar(new Error(m))).toMatchObject({
      codigo: "busy",
      errorCode: "connection_lost",
    });
  });

  it("un mensaje parecido pero distinto no se toma como conexión perdida", () => {
    expect(clasificar(new Error("Connection terminated por el usuario Ana")).codigo).toBe(
      "internal",
    );
  });

  it("57014 es reintentable pero se reporta (consulta lenta); 55P03 no se reporta", () => {
    expect(clasificar(prismaConSqlstate("P2010", "57014")).inesperado).toBe(true);
    expect(clasificar(prismaConSqlstate("P2010", "55P03")).inesperado).toBe(false);
  });

  it("una violación de constraint no prevista es un bug: 500", () => {
    expect(clasificar(prismaConSqlstate("P2010", "23514"))).toMatchObject({
      codigo: "internal",
      errorCode: "23514",
      inesperado: true,
    });
  });

  it("ErrorApi conserva código y extensiones y no se reporta", () => {
    const c = clasificar(new ErrorApi("invalid_reference", { field: "accountId" }));
    expect(c).toEqual({
      codigo: "invalid_reference",
      extensiones: { field: "accountId" },
      errorCode: "invalid_reference",
      inesperado: false,
    });
  });

  it("errorCode nunca es un mensaje", () => {
    expect(clasificar(new TypeError("monto 23500 de Ana")).errorCode).toBe("TypeError");
    expect(clasificar("texto suelto").errorCode).toBe("unknown");
    expect(clasificar(Object.assign(new Error(), { name: "nombre con espacios" })).errorCode).toBe(
      "unknown",
    );
  });
});
