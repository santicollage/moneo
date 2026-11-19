// RNF-SEG-08: las cabeceras que Next pone en toda respuesta (la prueba contra staging es de F4-06).
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("RNF-SEG-08 cabeceras de next.config.ts", () => {
  it("toda ruta: HSTS ≥ 1 año, nosniff, Referrer-Policy, frame-ancestors 'none' y CSP", async () => {
    const reglas = (await nextConfig.headers?.()) ?? [];
    expect(reglas.map((r) => r.source)).toEqual(["/((?!api/).*)", "/api/:path*"]);
    for (const regla of reglas) {
      const h = new Map(regla.headers.map((x) => [x.key, x.value]));
      const maxAge = Number(/max-age=(\d+)/.exec(h.get("Strict-Transport-Security") ?? "")?.[1]);
      expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
      expect(h.get("X-Content-Type-Options")).toBe("nosniff");
      expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(h.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    }
    const api = new Map(reglas[1]!.headers.map((x) => [x.key, x.value]));
    expect(api.get("Cache-Control")).toBe("no-store");
    expect(api.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("sin cabecera X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
