import type { ReactNode } from "react";

export const metadata = {
  title: "AMARA CORE",
  description: "Panel administrativo"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif" }}>{children}</body>
    </html>
  );
}