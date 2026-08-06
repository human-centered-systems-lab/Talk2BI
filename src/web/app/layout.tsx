import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Suspense } from "react";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Talk2BI",
  description: "Open-Sourced by Karlsruhe Institute of Technology (KIT)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <div
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <Providers>
            <TooltipProvider>
              <Suspense fallback={null}>
                <AppShell>{children}</AppShell>
              </Suspense>
            </TooltipProvider>
          </Providers>
        </div>
      </body>
    </html>
  );
}
