import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Moneo", template: "%s · Moneo" },
  description: "Las finanzas de la pareja, en un solo lugar.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <main className="mx-auto w-full max-w-md px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
