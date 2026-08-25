"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { ChevronDownIcon, LibraryBigIcon } from "lucide-react";

import {
  ToolFallbackContent,
  ToolFallbackRoot,
} from "@/components/assistant-ui/tool-fallback";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export const RetrieveOkfContextUI = makeAssistantToolUI<Record<string, never>, string>({
  toolName: "tool_retrieve_okf_context",
  render: ({ result, status }) => (
    <ToolFallbackRoot defaultOpen={status?.type === "running"}>
      <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2 px-4 text-sm transition-colors">
        <div className="flex grow items-center gap-2 text-start leading-none">
          <LibraryBigIcon className="size-4" />
          <span>
            {status?.type === "running"
              ? "Retrieving complete OKF evidence"
              : "Retrieved OKF evidence"}
          </span>
        </div>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 transition-transform duration-(--animation-duration) ease-out",
            "group-data-[state=closed]/trigger:-rotate-90",
            "group-data-[state=open]/trigger:rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <ToolFallbackContent>
        <div className="px-4 text-sm">
          {typeof result === "string" && result ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
              {result}
            </pre>
          ) : (
            <p className="text-muted-foreground">
              A ReAct retrieval agent is reading complete files from the available OKF bundles.
            </p>
          )}
        </div>
      </ToolFallbackContent>
    </ToolFallbackRoot>
  ),
});
