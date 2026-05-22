import type { Metadata } from "next";
import "./globals.css";
import { DM_Sans } from "next/font/google";
import { AppHeader } from "@/components/shared/app-header";
import { FloatingConsultor } from "@/components/shared/floating-consultor";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm-sans",
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
    <html lang="es" className={`h-full ${dmSans.variable}`}>
      <body className="min-h-full flex flex-col font-sans bg-surface antialiased">
        <AppHeader />
        <main className="flex-1 pb-16 lg:pb-0">{children}</main>
        <FloatingConsultor />
      </body>
    </html>
  );
}
