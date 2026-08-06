"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorMessage, SuccessMessage } from "@/components/graph/feedback";
import type {
  GraphColumn,
  GraphJoin,
  GraphTable,
  JoinCreateResult,
} from "@/components/graph/types";

export type JoinDraft = {
  leftTable: string;
  rightTable: string;
  leftColumn: string;
  rightColumn: string;
  relationshipType: string;
};

export function JoinDialog({
  open,
  onOpenChange,
  editing,
  draft,
  onDraftChange,
  onTableChange,
  tables,
  leftColumns,
  rightColumns,
  columnsLoading,
  saving,
  error,
  result,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: GraphJoin | null;
  draft: JoinDraft;
  onDraftChange: (draft: Partial<JoinDraft>) => void;
  onTableChange: (tableFullName: string, side: "left" | "right") => void;
  tables: GraphTable[];
  leftColumns: GraphColumn[];
  rightColumns: GraphColumn[];
  columnsLoading: boolean;
  saving: boolean;
  error: string;
  result: JoinCreateResult | null;
  onSave: () => void;
}) {
  const selectedLeftColumn = leftColumns.find(
    (column) => column.fullName === draft.leftColumn,
  );
  const selectedRightColumn = rightColumns.find(
    (column) => column.fullName === draft.rightColumn,
  );
  const canSave =
    draft.leftTable &&
    draft.rightTable &&
    draft.leftColumn &&
    draft.rightColumn &&
    draft.relationshipType &&
    draft.leftColumn !== draft.rightColumn;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit join" : "Add join"}</DialogTitle>
          <DialogDescription>
            Choose two tables, then connect their join columns with a JOINS_ON
            edge.
          </DialogDescription>
        </DialogHeader>

        <ErrorMessage message={error} />

        {result ? (
          <SuccessMessage>
            {editing ? "Updated" : "Created"} {result.join.relationshipType}{" "}
            join: {result.join.condition}
          </SuccessMessage>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Left Table</label>
            <select
              value={draft.leftTable}
              onChange={(event) => onTableChange(event.target.value, "left")}
              disabled={saving}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Choose a table</option>
              {tables.map((table) => (
                <option key={table.fullName} value={table.fullName}>
                  {table.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Right Table</label>
            <select
              value={draft.rightTable}
              onChange={(event) => onTableChange(event.target.value, "right")}
              disabled={saving}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Choose a table</option>
              {tables.map((table) => (
                <option key={table.fullName} value={table.fullName}>
                  {table.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <div className="text-sm font-medium">Join Condition</div>
          <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-muted-foreground">
                Left Column
              </label>
              <select
                value={draft.leftColumn}
                onChange={(event) =>
                  onDraftChange({ leftColumn: event.target.value })
                }
                disabled={saving || columnsLoading || leftColumns.length === 0}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Choose a column</option>
                {leftColumns.map((column) => (
                  <option key={column.fullName} value={column.fullName}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="pb-2 text-center text-sm font-semibold text-muted-foreground">
              =
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-muted-foreground">
                Right Column
              </label>
              <select
                value={draft.rightColumn}
                onChange={(event) =>
                  onDraftChange({ rightColumn: event.target.value })
                }
                disabled={saving || columnsLoading || rightColumns.length === 0}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Choose a column</option>
                {rightColumns.map((column) => (
                  <option key={column.fullName} value={column.fullName}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedLeftColumn && selectedRightColumn ? (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {selectedLeftColumn.name} = {selectedRightColumn.name}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Relationship Type</label>
          <select
            value={draft.relationshipType}
            onChange={(event) =>
              onDraftChange({ relationshipType: event.target.value })
            }
            disabled={saving}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="one-to-one">one-to-one</option>
            <option value="one-to-many">one-to-many</option>
            <option value="many-to-one">many-to-one</option>
            <option value="many-to-many">many-to-many</option>
          </select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Close
          </Button>
          <Button onClick={onSave} disabled={!canSave || saving}>
            {saving ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <CheckIcon className="size-4" />
            )}
            {editing ? "Save Changes" : "Create Edge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
