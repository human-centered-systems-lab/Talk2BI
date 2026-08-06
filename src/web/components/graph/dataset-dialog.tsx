"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, DatabaseIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchDatabases,
  fetchTables,
  getErrorMessage,
  syncGraphDatabase,
} from "@/components/graph/api";
import { dialects } from "@/components/graph/dialects";
import { ErrorMessage, SuccessMessage } from "@/components/graph/feedback";
import type {
  GraphTable,
  InitResult,
  WarehouseDatabase,
  WarehouseTable,
} from "@/components/graph/types";
import { getTableKey } from "@/components/graph/utils";
import { cn } from "@/lib/utils";

export type DatasetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set when managing an existing dataset, empty when adding a new one. */
  editingDatabase: string;
  configuredTables: GraphTable[];
  configuredDatabaseNames: Set<string>;
  onSaved: () => Promise<void> | void;
};

export function DatasetDialog({
  open,
  onOpenChange,
  editingDatabase,
  configuredTables,
  configuredDatabaseNames,
  onSaved,
}: DatasetDialogProps) {
  const [selectedDialect, setSelectedDialect] = useState("");
  const [databases, setDatabases] = useState<WarehouseDatabase[]>([]);
  const [databasesDialect, setDatabasesDialect] = useState("");
  const [selectedDatabase, setSelectedDatabase] = useState("");
  const [tables, setTables] = useState<WarehouseTable[]>([]);
  const [selectedTables, setSelectedTables] = useState<WarehouseTable[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<InitResult | null>(null);

  // Databricks calls the top-level container a catalog, Snowflake a database.
  const databaseLabel =
    selectedDialect === "Databricks" ? "Catalog" : "Database";
  const selectedKeys = useMemo(
    () => new Set(selectedTables.map(getTableKey)),
    [selectedTables],
  );
  const visibleSelectedCount = useMemo(
    () => tables.filter((table) => selectedKeys.has(getTableKey(table))).length,
    [selectedKeys, tables],
  );
  const schemaGroups = useMemo(() => {
    const groups = new Map<string, WarehouseTable[]>();

    tables.forEach((table) => {
      const schemaTables = groups.get(table.schema) ?? [];
      schemaTables.push(table);
      groups.set(table.schema, schemaTables);
    });

    return Array.from(groups.entries()).sort(([schemaA], [schemaB]) =>
      schemaA.localeCompare(schemaB),
    );
  }, [tables]);
  const selectableDatabases = useMemo(
    () =>
      databases.filter(
        (database) =>
          database.name === editingDatabase ||
          !configuredDatabaseNames.has(database.name),
      ),
    [configuredDatabaseNames, databases, editingDatabase],
  );

  const selectDatabase = (database: string) => {
    setSelectedDatabase(database);
    setSelectedTables(
      configuredTables
        .filter((table) => table.database === database)
        .map((table) => ({
          database: table.database,
          schema: table.schema,
          name: table.name,
        })),
    );
    setResult(null);
  };

  // Reset everything the dialog owns whenever it opens, then preselect the
  // dataset being managed.
  useEffect(() => {
    if (!open) return;

    setError("");
    setResult(null);
    setProgress(0);
    setProgressLabel("");

    if (editingDatabase) {
      const dataset = configuredTables.find(
        (table) => table.database === editingDatabase,
      );
      setSelectedDialect(dataset?.dialect ?? "Snowflake");
      selectDatabase(editingDatabase);
    } else {
      setSelectedDialect("");
      setSelectedDatabase("");
      setDatabases([]);
      setDatabasesDialect("");
      setTables([]);
      setSelectedTables([]);
    }
    // Re-running on every configuredTables change would clobber the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDatabase, open]);

  useEffect(() => {
    if (
      !open ||
      !selectedDialect ||
      databasesDialect === selectedDialect ||
      loadingDatabases
    ) {
      return;
    }

    setLoadingDatabases(true);
    setError("");
    fetchDatabases(selectedDialect)
      .then((nextDatabases) => {
        setDatabases(nextDatabases);
        setDatabasesDialect(selectedDialect);
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err, "Could not load databases."));
      })
      .finally(() => setLoadingDatabases(false));
  }, [databasesDialect, loadingDatabases, open, selectedDialect]);

  useEffect(() => {
    if (!open || !selectedDialect || !selectedDatabase) return;

    setLoadingTables(true);
    setError("");
    setTables([]);
    fetchTables(selectedDialect, selectedDatabase)
      .then(setTables)
      .catch((err: unknown) => {
        setError(getErrorMessage(err, "Could not load tables."));
      })
      .finally(() => setLoadingTables(false));
  }, [open, selectedDatabase, selectedDialect]);

  useEffect(() => {
    if (!saving) return;

    const interval = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return current;
        if (current < 30) return current + 5;
        if (current < 70) return current + 3;
        return current + 1;
      });
    }, 700);

    return () => window.clearInterval(interval);
  }, [saving]);

  const toggleTable = (table: WarehouseTable) => {
    const key = getTableKey(table);
    setSelectedTables((current) =>
      current.some((item) => getTableKey(item) === key)
        ? current.filter((item) => getTableKey(item) !== key)
        : [...current, table],
    );
  };

  const selectVisibleTables = () => {
    setSelectedTables((current) => {
      const next = new Map(current.map((table) => [getTableKey(table), table]));

      tables.forEach((table) => {
        next.set(getTableKey(table), table);
      });

      return Array.from(next.values());
    });
  };

  const deselectVisibleTables = () => {
    const visibleKeys = new Set(tables.map(getTableKey));

    setSelectedTables((current) =>
      current.filter((table) => !visibleKeys.has(getTableKey(table))),
    );
  };

  const saveDataset = async () => {
    if (!selectedDialect || !selectedDatabase || selectedTables.length === 0) {
      return;
    }

    setSaving(true);
    setError("");
    setResult(null);
    setProgress(8);
    setProgressLabel("Saving dataset tables and columns...");

    try {
      const data = await syncGraphDatabase(
        selectedDatabase,
        selectedDialect,
        selectedTables,
      );
      setProgress(96);
      setProgressLabel("Refreshing the saved dataset...");
      await onSaved();
      setProgress(100);
      setProgressLabel("Dataset ready");
      setResult(data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not save dataset."));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && saving) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editingDatabase
              ? `Manage ${editingDatabase}`
              : selectedDialect
                ? `Configure ${selectedDialect} dataset`
                : "Choose a dialect"}
          </DialogTitle>
          <DialogDescription>
            {selectedDialect
              ? `Choose tables from any schemas in this ${selectedDialect} ${databaseLabel.toLowerCase()}.`
              : "Select the data platform used by this dataset."}
          </DialogDescription>
        </DialogHeader>

        <ErrorMessage message={error} />

        {!selectedDialect ? (
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            {dialects.map((dialect) => (
              <button
                key={dialect.name}
                type="button"
                onClick={() => setSelectedDialect(dialect.name)}
                className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <dialect.icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {dialect.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Available
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : result ? (
          <div className="space-y-4">
            <SuccessMessage>
              Dataset loaded successfully. Created {result.tablesCreated} tables
              and {result.columnsCreated} columns
              {typeof result.joinsCreated === "number"
                ? ` with ${result.joinsCreated} joins.`
                : "."}
            </SuccessMessage>
            <p className="text-sm text-muted-foreground">
              The Dataset, Schema, Table, and Column nodes are ready in Context.
            </p>
          </div>
        ) : (
          <>
            <div className="grid min-h-96 overflow-hidden rounded-md border md:grid-cols-[16rem_1fr]">
              <div className="border-b bg-muted/20 md:border-b-0 md:border-r">
                <div className="border-b px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                  {databaseLabel}s
                </div>
                <div className="max-h-80 overflow-auto p-2">
                  {loadingDatabases ? (
                    <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                      <Loader2Icon className="size-4 animate-spin" />
                      Loading {databaseLabel.toLowerCase()}s...
                    </div>
                  ) : selectableDatabases.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      {editingDatabase
                        ? `${databaseLabel} is no longer available in ${selectedDialect}.`
                        : `No more ${databaseLabel.toLowerCase()}s available.`}
                    </p>
                  ) : (
                    selectableDatabases.map((db) => (
                      <button
                        key={db.name}
                        type="button"
                        onClick={() => selectDatabase(db.name)}
                        disabled={saving}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                          selectedDatabase === db.name
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <DatabaseIcon className="size-4 shrink-0" />
                        <span className="truncate">{db.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex min-w-0 flex-col">
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {selectedDatabase ||
                        `Select a ${databaseLabel.toLowerCase()}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Schemas and tables
                    </div>
                  </div>
                  {tables.length > 0 ? (
                    <div className="flex shrink-0 justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={selectVisibleTables}
                        disabled={
                          visibleSelectedCount === tables.length || saving
                        }
                      >
                        Select all
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={deselectVisibleTables}
                        disabled={visibleSelectedCount === 0 || saving}
                      >
                        Clear
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="max-h-80 flex-1 overflow-auto">
                  {!selectedDatabase ? (
                    <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                      Choose a {databaseLabel.toLowerCase()} on the left.
                    </div>
                  ) : loadingTables ? (
                    <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                      <Loader2Icon className="size-4 animate-spin" />
                      Loading schemas and tables...
                    </div>
                  ) : tables.length === 0 ? (
                    <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                      No tables found in this database.
                    </div>
                  ) : (
                    schemaGroups.map(([schema, schemaTables]) => (
                      <div key={schema} className="border-b last:border-b-0">
                        <div className="bg-muted/30 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                          {schema}
                        </div>
                        {schemaTables.map((table) => {
                          const key = getTableKey(table);
                          const isSelected = selectedKeys.has(key);

                          return (
                            <label
                              key={key}
                              className="grid cursor-pointer grid-cols-[1.5rem_1fr] items-center gap-3 border-t px-3 py-2"
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => {
                                  setResult(null);
                                  toggleTable(table);
                                }}
                                disabled={saving}
                              />
                              <span className="truncate text-sm font-medium">
                                {table.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {selectedTables.length} table
                {selectedTables.length === 1 ? "" : "s"} selected
              </span>
              {selectedDatabase && tables.length > 0 ? (
                <span>
                  {visibleSelectedCount} of {tables.length} visible selected
                </span>
              ) : null}
            </div>

            {saving ? (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{progressLabel}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={Math.round(progress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${selectedDialect} import progress`}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            {result ? "Close" : "Cancel"}
          </Button>
          {selectedDialect && !result ? (
            <Button
              onClick={saveDataset}
              disabled={saving || selectedTables.length === 0 || loadingTables}
            >
              {saving ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckIcon className="size-4" />
                  Save Dataset
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
