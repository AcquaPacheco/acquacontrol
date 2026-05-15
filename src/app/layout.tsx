import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/shared/app-header";
import { FloatingConsultor } from "@/components/shared/floating-consultor";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ACQUA CONTROL OS",
  description: "Sistema operativo comercial premium — Acqua Pacheco",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans bg-surface">
        <AppHeader />
        <main className="flex-1 pb-16 lg:pb-0">{children}</main>
        <FloatingConsultor />
      </body>
    </html>
  );
}
