"use client";

import { ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";
import { usePathname } from "next/navigation";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

type PageHeaderProps = {
  chatActions?: ReactNode;
};

const PAGE_TITLES: Record<string, string> = {
  "/chat": "New Chat",
  "/evaluation": "Evaluation",
  "/graph": "Data & Context",
  "/settings": "Settings",
};

export function PageHeader({ chatActions }: PageHeaderProps) {
  const pathname = usePathname();
  const activeRemoteId = useAuiState((state) => state.threadListItem.remoteId);
  const activeThreadTitle = useAuiState(
    (state) => state.threadListItem.title,
  );
  const isThreadPage = pathname.startsWith("/chat/");
  const threadId = isThreadPage ? pathname.slice("/chat/".length) : undefined;
  const isChatPage = pathname === "/chat" || isThreadPage;
  const title = isThreadPage
    ? activeRemoteId === threadId && activeThreadTitle !== "Chat"
      ? activeThreadTitle ?? ""
      : ""
    : PAGE_TITLES[pathname];

  if (title === undefined) return null;

  return (
    <header className="flex h-12 w-full justify-center">
      <div className="flex w-full items-center justify-between gap-4 p-3 px-5 text-sm">
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <div className="flex shrink-0 items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
          </div>

          <h1 aria-live="polite" className="h-7 truncate leading-7">
            {title}
          </h1>
        </div>

        {isChatPage && chatActions ? (
          <div className="flex shrink-0 items-center gap-2 text-sm">
            {chatActions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
