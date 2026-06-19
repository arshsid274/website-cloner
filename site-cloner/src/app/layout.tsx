import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Site Cloner",
  description: "Scan a domain, then clone it to your Downloads folder.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
