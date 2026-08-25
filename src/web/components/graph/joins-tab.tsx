"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  Edit3Icon,
  Link2Icon,
  Loader2Icon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createJoin,
  deleteJoin,
  fetchColumns,
  fetchJoins,
  getErrorMessage,
  updateJoin,
} from "@/components/graph/api";
import { ErrorMessage, LoadingRow } from "@/components/graph/feedback";
import { JoinDialog, type JoinDraft } from "@/components/graph/join-dialog";
import type {
  GraphChangeHandler,
  GraphColumn,
  GraphJoin,
  GraphJoinSuggestion,
  JoinCreateResult,
} from "@/components/graph/types";
import type { SchemaTablesStore } from "@/components/graph/use-schema-tables";

const emptyDraft: JoinDraft = {
  leftTable: "",
  rightTable: "",
  leftColumn: "",
  rightColumn: "",
  relationshipType: "many-to-one",
};

export function JoinsTab({
  schema,
  onGraphChanged,
}: {
  schema: SchemaTablesStore;
  onGraphChanged: GraphChangeHandler;
}) {
  const [joins, setJoins] = useState<GraphJoin[]>([]);
  const [suggestions, setSuggestions] = useState<GraphJoinSuggestion[]>([]);
  const [joinsLoading, setJoinsLoading] = useState(false);
  const [joinsError, setJoinsError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<JoinDraft>(emptyDraft);
  const [leftColumns, setLeftColumns] = useState<GraphColumn[]>([]);
  const [rightColumns, setRightColumns] = useState<GraphColumn[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acceptingAll, setAcceptingAll] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [dialogResult, setDialogResult] = useState<JoinCreateResult | null>(
    null,
  );
  const [joinToDelete, setJoinToDelete] = useState<GraphJoin | null>(null);
  const [deletingJoin, setDeletingJoin] = useState(false);
  const [joinToEdit, setJoinToEdit] = useState<GraphJoin | null>(null);

  const { loading: schemaLoading, tables: schemaTables, reload: reloadSchema } =
    schema;

  const loadJoins = useCallback(async () => {
    setJoinsLoading(true);
    setJoinsError("");

    try {
      const data = await fetchJoins();
      setJoins(data.joins);
      setSuggestions(data.suggestions ?? []);
    } catch (err) {
      setJoinsError(getErrorMessage(err, "Could not load graph joins."));
    } finally {
      setJoinsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJoins();
  }, [loadJoins]);

  useEffect(() => {
    if (schemaTables.length > 0 || schemaLoading) return;
    void reloadSchema();
    // Only fills the table pickers when another tab has not loaded them yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshTab = async () => {
    await Promise.all([schema.reload(), loadJoins()]);
  };

  const resetForm = () => {
    setJoinToEdit(null);
    setDraft(emptyDraft);
    setLeftColumns([]);
    setRightColumns([]);
    setDialogError("");
    setDialogResult(null);
  };

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) resetForm();
  };

  const openJoinCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openJoinEdit = async (join: GraphJoin) => {
    setJoinToEdit(join);
    setDialogResult(null);
    setDialogError("");
    setDraft({
      leftTable: join.leftTableFullName,
      rightTable: join.rightTableFullName,
      leftColumn: join.leftColumnFullName,
      rightColumn: join.rightColumnFullName,
      relationshipType: join.relationshipType || "many-to-one",
    });
    setDialogOpen(true);
    setColumnsLoading(true);

    try {
      const [nextLeftColumns, nextRightColumns] = await Promise.all([
        fetchColumns(join.leftTableFullName),
        fetchColumns(join.rightTableFullName),
      ]);
      setLeftColumns(nextLeftColumns);
      setRightColumns(nextRightColumns);
    } catch (err) {
      setDialogError(getErrorMessage(err, "Could not load join columns."));
    } finally {
      setColumnsLoading(false);
    }
  };

  const loadJoinColumns = async (
    tableFullName: string,
    side: "left" | "right",
  ) => {
    if (side === "left") {
      setDraft((current) => ({
        ...current,
        leftTable: tableFullName,
        leftColumn: "",
      }));
      setLeftColumns([]);
    } else {
      setDraft((current) => ({
        ...current,
        rightTable: tableFullName,
        rightColumn: "",
      }));
      setRightColumns([]);
    }

    if (!tableFullName) return;

    setColumnsLoading(true);
    setDialogError("");

    try {
      const nextColumns = await fetchColumns(tableFullName);
      if (side === "left") {
        setLeftColumns(nextColumns);
      } else {
        setRightColumns(nextColumns);
      }
    } catch (err) {
      setDialogError(getErrorMessage(err, "Could not load join columns."));
    } finally {
      setColumnsLoading(false);
    }
  };

  const saveJoin = async () => {
    setSaving(true);
    setDialogError("");
    setDialogResult(null);

    try {
      const payload = {
        leftTableFullName: draft.leftTable,
        rightTableFullName: draft.rightTable,
        leftColumnFullName: draft.leftColumn,
        rightColumnFullName: draft.rightColumn,
        relationshipType: draft.relationshipType,
      };
      const data = joinToEdit
        ? await updateJoin(joinToEdit, payload)
        : await createJoin(payload);

      setDialogResult(data);
      if (joinToEdit) {
        setDialogOpen(false);
        resetForm();
      }
      onGraphChanged();
      await loadJoins();
    } catch (err) {
      setDialogError(getErrorMessage(err, "Could not create join."));
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteJoin = async () => {
    if (!joinToDelete) return;

    setDeletingJoin(true);
    setJoinsError("");

    try {
      await deleteJoin(joinToDelete);
      setJoinToDelete(null);
      onGraphChanged();
      await loadJoins();
    } catch (err) {
      setJoinsError(getErrorMessage(err, "Could not delete join."));
    } finally {
      setDeletingJoin(false);
    }
  };

  const createSuggestedJoin = async (suggestion: GraphJoinSuggestion) => {
    setSaving(true);
    setJoinsError("");

    try {
      await createJoin({
        leftTableFullName: suggestion.leftTableFullName,
        rightTableFullName: suggestion.rightTableFullName,
        leftColumnFullName: suggestion.leftColumnFullName,
        rightColumnFullName: suggestion.rightColumnFullName,
        relationshipType: suggestion.relationshipType,
      });
      onGraphChanged();
      await loadJoins();
    } catch (err) {
      setJoinsError(getErrorMessage(err, "Could not create suggested join."));
    } finally {
      setSaving(false);
    }
  };

  const acceptAllSuggestedJoins = async () => {
    if (suggestions.length === 0) return;

    setAcceptingAll(true);
    setJoinsError("");

    try {
      const results = await Promise.allSettled(
        suggestions.map((suggestion) =>
          createJoin({
            leftTableFullName: suggestion.leftTableFullName,
            rightTableFullName: suggestion.rightTableFullName,
            leftColumnFullName: suggestion.leftColumnFullName,
            rightColumnFullName: suggestion.rightColumnFullName,
            relationshipType: suggestion.relationshipType,
          }),
        ),
      );
      const failedCount = results.filter(
        (result) => result.status === "rejected",
      ).length;

      onGraphChanged();
      await loadJoins();

      if (failedCount > 0) {
        setJoinsError(
          `Accepted ${results.length - failedCount} suggestions, but ${failedCount} failed.`,
        );
      }
    } catch (err) {
      setJoinsError(getErrorMessage(err, "Could not accept suggested joins."));
    } finally {
      setAcceptingAll(false);
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-auto p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Joins</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create OKF Join Reference concepts. Columns remain metadata inside
            their table concepts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void refreshTab()}
            disabled={schema.loading || joinsLoading}
          >
            {schema.loading || joinsLoading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RotateCcwIcon className="size-4" />
            )}
            Refresh
          </Button>
          <Button
            disabled={schema.tables.length === 0}
            onClick={openJoinCreate}
          >
            <Link2Icon className="size-4" />
            Add Join
          </Button>
          <JoinDialog
            open={dialogOpen}
            onOpenChange={handleDialogChange}
            editing={joinToEdit}
            draft={draft}
            onDraftChange={(changes) =>
              setDraft((current) => ({ ...current, ...changes }))
            }
            onTableChange={(tableFullName, side) =>
              void loadJoinColumns(tableFullName, side)
            }
            tables={schema.tables}
            leftColumns={leftColumns}
            rightColumns={rightColumns}
            columnsLoading={columnsLoading}
            saving={saving}
            error={dialogError}
            result={dialogResult}
            onSave={() => void saveJoin()}
          />
        </div>
      </div>

      <ErrorMessage message={schema.error} />
      <ErrorMessage message={joinsError} />

      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-[minmax(14rem,1fr)_minmax(16rem,1.3fr)_minmax(14rem,1fr)_10rem_8rem] border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
          <span>Left</span>
          <span>Condition</span>
          <span>Right</span>
          <span>Type</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="max-h-[calc(100dvh-15rem)] overflow-auto">
          {joinsLoading ? (
            <LoadingRow label="Loading joins" />
          ) : joins.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              No joins defined in the graph.
            </div>
          ) : (
            joins.map((join) => (
              <div
                key={join.id}
                className="grid grid-cols-[minmax(14rem,1fr)_minmax(16rem,1.3fr)_minmax(14rem,1fr)_10rem_8rem] items-center gap-3 border-b px-3 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {join.leftTableName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {join.leftColumnName || `${join.columnCount} columns`}
                  </div>
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {join.condition ||
                    `${join.leftTableName} JOINS_ON ${join.rightTableName}`}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {join.rightTableName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {join.rightColumnName || `${join.columnCount} columns`}
                  </div>
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {join.relationshipType || "JOINS_ON"}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openJoinEdit(join)}
                    disabled={
                      deletingJoin ||
                      !join.leftColumnFullName ||
                      !join.rightColumnFullName
                    }
                    title={
                      join.leftColumnFullName && join.rightColumnFullName
                        ? "Edit join"
                        : "Only column joins can be edited"
                    }
                  >
                    <Edit3Icon className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setJoinToDelete(join)}
                    disabled={deletingJoin}
                    title="Delete join"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold">Suggested Joins</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Proposed from matching column names that are not connected yet.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {suggestions.length} suggestion
              {suggestions.length === 1 ? "" : "s"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void acceptAllSuggestedJoins()}
              disabled={
                suggestions.length === 0 ||
                joinsLoading ||
                acceptingAll ||
                saving
              }
            >
              {acceptingAll ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <CheckIcon className="size-4" />
              )}
              Accept all
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(14rem,1fr)_minmax(16rem,1.3fr)_minmax(14rem,1fr)_8rem_7rem] border-b bg-muted/20 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
          <span>Left</span>
          <span>Condition</span>
          <span>Right</span>
          <span>Reason</span>
          <span className="text-right">Create</span>
        </div>
        <div className="max-h-72 overflow-auto">
          {joinsLoading ? (
            <LoadingRow label="Loading suggestions" />
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No missing joins suggested from column names.
            </div>
          ) : (
            suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="grid grid-cols-[minmax(14rem,1fr)_minmax(16rem,1.3fr)_minmax(14rem,1fr)_8rem_7rem] items-center gap-3 border-b px-3 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {suggestion.leftTableName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {suggestion.leftColumnName}
                  </div>
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {suggestion.leftColumnName} = {suggestion.rightColumnName}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {suggestion.rightTableName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {suggestion.rightColumnName}
                  </div>
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {suggestion.reason}
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void createSuggestedJoin(suggestion)}
                    disabled={saving || acceptingAll}
                  >
                    {saving || acceptingAll ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <CheckIcon className="size-4" />
                    )}
                    Add
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog
        open={joinToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setJoinToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete join</DialogTitle>
            <DialogDescription>
              This removes the OKF Join Reference concept from the graph.
            </DialogDescription>
          </DialogHeader>
          {joinToDelete ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {joinToDelete.condition ||
                `${joinToDelete.leftTableName} JOINS_ON ${joinToDelete.rightTableName}`}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setJoinToDelete(null)}
              disabled={deletingJoin}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDeleteJoin()}
              disabled={deletingJoin}
            >
              {deletingJoin ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <Trash2Icon className="size-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
