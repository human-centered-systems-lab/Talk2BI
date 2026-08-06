import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../globals.css";

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
  description: "Open-Source by Karlsruhe Institute of Technology (KIT)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `flex min-h-0 flex-1 flex-col` keeps the height chain intact from
    // AppShell's h-dvh down to the thread: without it this div sizes to its
    // content, the thread has no bounded height, and the composer can neither
    // center (new chat) nor dock to the bottom (thread with messages).
    <div
      className={`${geistSans.variable} ${geistMono.variable} antialiased flex min-h-0 flex-1 flex-col`}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </div>
  );
}
