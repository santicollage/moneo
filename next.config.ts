import type { NextConfig } from "next";
import { CABECERAS_COMUNES, CSP_API, cspPaginas } from "./src/server/shared/http/cabeceras";

const desarrollo = process.env.NODE_ENV !== "production";
const comunes = CABECERAS_COMUNES.map(([key, value]) => ({ key, value }));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // RNF-SEG-08: cabeceras en toda respuesta. La API también las pone en `manejar()`.
  async headers() {
    return [
      {
        source: "/((?!api/).*)",
        headers: [...comunes, { key: "Content-Security-Policy", value: cspPaginas(desarrollo) }],
      },
      {
        source: "/api/:path*",
        headers: [
          ...comunes,
          { key: "Content-Security-Policy", value: CSP_API },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
