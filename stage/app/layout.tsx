import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Q4 Stokvel",
  description: "Investec holds the rand. The chain holds the rulebook.",
};

export const viewport: Viewport = { themeColor: "#0B1426", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text">{children}</body>
    </html>
  );
}
