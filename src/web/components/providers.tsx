"use client";

import { ThemeProvider } from "next-themes";
import { ReactNode } from "react";
import { ModelProvider } from "@/components/model-provider";
import { ProfileProvider } from "@/components/profile-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ModelProvider>
        <ProfileProvider>{children}</ProfileProvider>
      </ModelProvider>
    </ThemeProvider>
  );
}
