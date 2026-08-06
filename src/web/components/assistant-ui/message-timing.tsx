"use client";

import { useMessageTiming } from "@assistant-ui/react";
import { ClockIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatMilliseconds(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatSpeed(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)} tok/s`;
}

export function MessageTiming() {
  const timing = useMessageTiming();

  if (!timing) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-6 items-center gap-1 self-center rounded-md bg-transparent px-1.5 text-xs leading-none text-muted-foreground hover:bg-background hover:text-foreground dark:hover:bg-muted">
          <ClockIcon className="size-3.5" />
          {formatMilliseconds(timing.totalStreamTime)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" align="center">
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">First token</dt>
          <dd className="text-right font-medium">
            {formatMilliseconds(timing.firstTokenTime)}
          </dd>
          <dt className="text-muted-foreground">Total</dt>
          <dd className="text-right font-medium">
            {formatMilliseconds(timing.totalStreamTime)}
          </dd>
          <dt className="text-muted-foreground">Speed</dt>
          <dd className="text-right font-medium">
            {formatSpeed(timing.tokensPerSecond)}
          </dd>
          <dt className="text-muted-foreground">Chunks</dt>
          <dd className="text-right font-medium">{timing.totalChunks}</dd>
          {timing.toolCallCount > 0 ? (
            <>
              <dt className="text-muted-foreground">Tools</dt>
              <dd className="text-right font-medium">
                {timing.toolCallCount}
              </dd>
            </>
          ) : null}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}
