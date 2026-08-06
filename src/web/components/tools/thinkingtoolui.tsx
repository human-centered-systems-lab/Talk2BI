"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  BrainIcon,
  ChevronDownIcon,
} from "lucide-react";
import {
  ToolFallbackContent,
  ToolFallbackRoot,
} from "@/components/assistant-ui/tool-fallback";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type ThinkingArgs = {
  reflection: string;
};

type ThinkingResult = string;

export const ThinkingToolUI = makeAssistantToolUI<ThinkingArgs, ThinkingResult>({
  toolName: "thinking",
  render: ({ args, result, status }) => {
    return (
      <ToolFallbackRoot defaultOpen={false}>
        <CollapsibleTrigger
          data-slot="thinking-tool-trigger"
          className="group/trigger flex w-full items-center gap-2 px-4 text-sm transition-colors"
        >
          <div className="flex grow items-center gap-2 text-start leading-none">
            <BrainIcon className="size-4" />
            <span>Thinking</span>
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
          <div className="space-y-2 px-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1 font-medium">Strategy</p>
              <p className="whitespace-pre-wrap">{args.reflection}</p>
            </div>

            {result ? (
              <div className="border-t border-dashed pt-2">
                <p className="text-muted-foreground mb-1 font-medium">Result</p>
                <p className="whitespace-pre-wrap">{result}</p>
              </div>
            ) : null}
          </div>
        </ToolFallbackContent>
      </ToolFallbackRoot>
    );
  },
});
