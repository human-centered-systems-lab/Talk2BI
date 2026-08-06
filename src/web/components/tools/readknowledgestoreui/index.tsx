"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  ChevronDownIcon,
  DatabaseIcon,
} from "lucide-react";
import {
  ToolFallbackContent,
  ToolFallbackRoot,
} from "@/components/assistant-ui/tool-fallback";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type Neo4jArgs = {
  query: string;
};

type Neo4jResult = {
  success?: boolean;
  data?: unknown;
  summary?: {
    nodesCreated?: number;
    relationshipsCreated?: number;
    nodesDeleted?: number;
    relationshipsDeleted?: number;
  };
  error?: string;
};

const MAX_HEADER_QUERY_LENGTH = 80;

export const ReadKnowledgeStoreUI = makeAssistantToolUI<
  Neo4jArgs,
  Neo4jResult | string
>({
  toolName: "tool_read_knowledge_store",
  render: ({ args, result, status }) => {
    const error =
      typeof result === "object" && result !== null ? result.error : undefined;
    const okf = typeof result === "string" ? result : null;
    const data =
      typeof result === "object" && result !== null ? result.data : undefined;
    const summary =
      typeof result === "object" && result !== null
        ? result.summary
        : undefined;

    return (
      <ToolFallbackRoot defaultOpen={status?.type === "running"}>
        <CollapsibleTrigger
          data-slot="neo4j-tool-trigger"
          className="group/trigger flex w-full items-center gap-2 px-4 text-sm transition-colors"
        >
          <div className="flex grow items-center gap-2 text-start leading-none">
            <DatabaseIcon className="size-4" />
            <span>{formatHeader(args.query)}</span>
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
          <div className="space-y-3 px-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1 font-medium">Query</p>
              <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                {args.query}
              </pre>
            </div>

            {error ? (
              <div className="border-t border-dashed pt-2">
                <p className="text-destructive mb-1 font-medium">Error</p>
                <p className="text-destructive whitespace-pre-wrap">
                  {error}
                </p>
              </div>
            ) : null}

            {okf ? (
              <div className="border-t border-dashed pt-2">
                <p className="text-muted-foreground mb-1 font-medium">
                  OKF
                </p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {okf}
                </pre>
              </div>
            ) : null}

            {data ? (
              <div className="border-t border-dashed pt-2">
                <p className="text-muted-foreground mb-1 font-medium">
                  Results
                </p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </div>
            ) : null}

            {summary ? (
              <div className="border-t border-dashed pt-2">
                <p className="text-muted-foreground mb-1 font-medium">
                  Summary
                </p>
                <ul className="grid grid-cols-2 gap-2 text-xs">
                  {summary.nodesCreated !== undefined && (
                    <li>
                      Nodes created:{" "}
                      <span className="font-medium">
                        {summary.nodesCreated}
                      </span>
                    </li>
                  )}
                  {summary.relationshipsCreated !== undefined && (
                    <li>
                      Relationships created:{" "}
                      <span className="font-medium">
                        {summary.relationshipsCreated}
                      </span>
                    </li>
                  )}
                  {summary.nodesDeleted !== undefined && (
                    <li>
                      Nodes deleted:{" "}
                      <span className="font-medium">
                        {summary.nodesDeleted}
                      </span>
                    </li>
                  )}
                  {summary.relationshipsDeleted !== undefined && (
                    <li>
                      Relationships deleted:{" "}
                      <span className="font-medium">
                        {summary.relationshipsDeleted}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        </ToolFallbackContent>
      </ToolFallbackRoot>
    );
  },
});

function formatHeader(query: string) {
  const trimmed = query.trim();

  if (!trimmed) return "Searching knowledge store";

  const displayQuery =
    trimmed.length > MAX_HEADER_QUERY_LENGTH
      ? `${trimmed.slice(0, MAX_HEADER_QUERY_LENGTH)}...`
      : trimmed;

  return `Searching for ${displayQuery}`;
}
