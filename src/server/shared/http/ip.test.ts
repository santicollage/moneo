// F4-04c · IP del cliente para el límite por IP (DN-2).
import { describe, expect, it } from "vitest";
import { IP_DESCONOCIDA, ipCliente, normalizarIp } from "./ip";

const pedir = (cabeceras: Record<string, string>) =>
  new Request("https://moneo.vercel.app/api/v1/auth/login", { headers: cabeceras });

describe("F4-04c IP confiable", () => {
  it("en Vercel usa x-vercel-forwarded-for e ignora las que el cliente puede fijar", () => {
    const p = pedir({
      "x-vercel-forwarded-for": "190.24.10.5",
      "x-forwarded-for": "6.6.6.6",
      "x-real-ip": "7.7.7.7",
    });
    expect(ipCliente(p, true)).toBe("190.24.10.5");
    expect(ipCliente(pedir({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" }), true)).toBe(
      IP_DESCONOCIDA,
    );
  });

  it("fuera de Vercel no hay proxy confiable: todas cuentan igual", () => {
    expect(ipCliente(pedir({ "x-vercel-forwarded-for": "190.24.10.5" }), false)).toBe(
      IP_DESCONOCIDA,
    );
  });

  it("una lista toma la primera; basura → desconocida", () => {
    expect(ipCliente(pedir({ "x-vercel-forwarded-for": "190.24.10.5, 10.0.0.1" }), true)).toBe(
      "190.24.10.5",
    );
    expect(normalizarIp("no-es-ip")).toBe(IP_DESCONOCIDA);
    expect(normalizarIp("")).toBe(IP_DESCONOCIDA);
    expect(normalizarIp(null)).toBe(IP_DESCONOCIDA);
  });

  it("IPv6 por /64 (dos direcciones de la misma red cuentan juntas) e IPv4 mapeada como IPv4", () => {
    const a = normalizarIp("2800:e2:2a80:1f9:a1b2:c3d4:e5f6:1");
    const b = normalizarIp("2800:00e2:2a80:01f9::99");
    expect(a).toBe("2800:e2:2a80:1f9::/64");
    expect(b).toBe(a);
    expect(normalizarIp("2800:e2:2a80:1fa::1")).not.toBe(a);
    expect(normalizarIp("::1")).toBe("0:0:0:0::/64");
    expect(normalizarIp("::ffff:190.24.10.5")).toBe("190.24.10.5");
  });
});
