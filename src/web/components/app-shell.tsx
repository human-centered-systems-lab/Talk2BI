"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/assistant-ui/app-sidebar";
import { PageHeader } from "@/components/assistant-ui/page-header";
import { AlfredRuntimeProvider } from "@/components/assistant-ui/runtime-provider";
import { SettingsDialog } from "@/components/assistant-ui/settings-dialog";
import { EnvVarWarning } from "@/components/env-var-warning";
import { RetrieveOkfContextUI } from "@/components/tools/retrieveokfcontextui";
import {
  DatabricksSqlQueryUI,
  SnowflakeSqlQueryUI,
} from "@/components/tools/sqlqueryui";
import { ThinkingToolUI } from "@/components/tools/thinkingtoolui";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { hasEnvVars } from "@/lib/utils";

/**
 * Routes that render without a session. Mirrors the rule in
 * `lib/supabase/proxy.ts`, which redirects every other route to the login page
 * when there is no user — so these are exactly the pages a signed-out visitor
 * can reach, and none of them show chats.
 */
function isPublicRoute(pathname: string) {
  return pathname.startsWith("/auth") || pathname.startsWith("/login");
}

/**
 * The chat runtime and the sidebar read user-scoped threads, so they are
 * mounted only on signed-in routes. That keeps `/api/threads` from being
 * called before sign-in, and mounts the runtime fresh on the way in, which
 * loads the thread list for whoever just signed in.
 *
 * Gating on the auth state instead would unmount the runtime the moment
 * `signOut()` resolves — while the chat page is still on screen and still
 * needs its provider. Sign-out always navigates here, so the route is the
 * signal that survives that transition.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isPublicRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <AlfredRuntimeProvider>
      <ThinkingToolUI />
      <RetrieveOkfContextUI />
      <SnowflakeSqlQueryUI />
      <DatabricksSqlQueryUI />

      <SidebarProvider>
        <SettingsDialog />
        <div className="flex h-dvh w-full pr-0.5">
          <AppSidebar variant="inset" />
          <SidebarInset className="min-h-0 overflow-hidden">
            <PageHeader chatActions={!hasEnvVars ? <EnvVarWarning /> : null} />
            {children}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AlfredRuntimeProvider>
  );
}
