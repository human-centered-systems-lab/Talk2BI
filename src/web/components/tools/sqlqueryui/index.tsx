"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  ChevronDownIcon,
  DatabaseZapIcon,
} from "lucide-react";
import {
  ToolFallbackContent,
  ToolFallbackRoot,
} from "@/components/assistant-ui/tool-fallback";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type SqlDbQueryArgs = {
  description?: string;
  query: string;
};

type SqlRow = Record<string, unknown>;

type SqlDbQueryResult = {
  success?: boolean;
  rowCount?: number;
  data?: SqlRow[];
  error?: string;
};

const MAX_PREVIEW_ROWS = 20;
const MAX_CELL_LENGTH = 240;

const createSqlQueryToolUI = (toolName: string, fallbackLabel: string) =>
  makeAssistantToolUI<SqlDbQueryArgs, SqlDbQueryResult>({
    toolName,
    render: ({ args, result, status }) => {
      const rows = Array.isArray(result?.data) ? result.data : [];
      const columns = getColumns(rows);
      const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);

      return (
        <ToolFallbackRoot defaultOpen={status?.type === "running"}>
          <CollapsibleTrigger
            data-slot="sql-query-tool-trigger"
            className="group/trigger flex w-full items-center gap-2 px-4 text-sm transition-colors"
          >
            <div className="flex grow items-center gap-2 text-start leading-none">
              <DatabaseZapIcon className="size-4" />
              <span>{args.description || fallbackLabel}</span>
              {result?.rowCount !== undefined ? (
                <span className="text-muted-foreground text-xs">
                  {result.rowCount} {result.rowCount === 1 ? "row" : "rows"}
                </span>
              ) : null}
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
              {args.description ? (
                <div>
                  <p className="text-muted-foreground mb-1 font-medium">
                    Description
                  </p>
                  <p className="whitespace-pre-wrap">{args.description}</p>
                </div>
              ) : null}

              <div>
                <p className="text-muted-foreground mb-1 font-medium">Query</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
                  {args.query}
                </pre>
              </div>

              {result?.error ? (
                <div className="border-t border-dashed pt-2">
                  <p className="text-destructive mb-1 font-medium">Error</p>
                  <p className="text-destructive whitespace-pre-wrap">
                    {result.error}
                  </p>
                </div>
              ) : null}

              {result?.success && rows.length === 0 ? (
                <div className="border-t border-dashed pt-2">
                  <p className="text-muted-foreground">No rows returned.</p>
                </div>
              ) : null}

              {rows.length > 0 ? (
                <div className="border-t border-dashed pt-2">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-muted-foreground font-medium">Result</p>
                    {rows.length > MAX_PREVIEW_ROWS ? (
                      <p className="text-muted-foreground text-xs">
                        Showing {MAX_PREVIEW_ROWS} of {rows.length}
                      </p>
                    ) : null}
                  </div>
                  <div className="max-h-80 overflow-auto rounded border">
                    <table className="w-full min-w-max text-left text-xs">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          {columns.map((column) => (
                            <th
                              key={column}
                              className="border-b px-2 py-1.5 font-medium"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, index) => (
                          <tr key={index} className="border-b last:border-b-0">
                            {columns.map((column) => (
                              <td
                                key={column}
                                className="max-w-72 align-top px-2 py-1.5"
                              >
                                <span className="whitespace-pre-wrap break-words font-mono">
                                  {formatCell(row[column])}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </ToolFallbackContent>
        </ToolFallbackRoot>
      );
    },
  });

export const SnowflakeSqlQueryUI = createSqlQueryToolUI(
  "tool_snowflake_sql_query",
  "Snowflake Query",
);

export const DatabricksSqlQueryUI = createSqlQueryToolUI(
  "tool_databricks_sql_query",
  "Databricks Query",
);

function getColumns(rows: SqlRow[]) {
  return Array.from(
    rows.reduce((columns, row) => {
      Object.keys(row).forEach((key) => columns.add(key));
      return columns;
    }, new Set<string>()),
  );
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "";

  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);

  if (text.length <= MAX_CELL_LENGTH) return text;

  return `${text.slice(0, MAX_CELL_LENGTH)}...`;
}
