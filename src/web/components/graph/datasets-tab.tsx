"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  Columns3Icon,
  DatabaseIcon,
  Edit3Icon,
  Loader2Icon,
  PlusIcon,
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
  fetchColumns,
  fetchTables,
  getErrorMessage,
  removeGraphDatabase,
  syncGraphDatabase,
  updateColumnDescription,
  updateTableDescription,
} from "@/components/graph/api";
import { DatasetDialog } from "@/components/graph/dataset-dialog";
import { DatasetDialectIcon } from "@/components/graph/dialects";
import { ErrorMessage, LoadingRow } from "@/components/graph/feedback";
import type {
  GraphChangeHandler,
  GraphColumn,
  GraphTable,
} from "@/components/graph/types";
import type { SchemaTablesStore } from "@/components/graph/use-schema-tables";
import {
  getTableKey,
  groupGraphTablesBySchema,
  parseSynonyms,
} from "@/components/graph/utils";

export function DatasetsTab({
  schema,
  onGraphChanged,
}: {
  schema: SchemaTablesStore;
  onGraphChanged: GraphChangeHandler;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDatabase, setEditingDatabase] = useState("");
  const [databaseToRemove, setDatabaseToRemove] = useState("");
  const [removingDatabase, setRemovingDatabase] = useState(false);
  const [syncingDatabase, setSyncingDatabase] = useState("");
  const [tableToEdit, setTableToEdit] = useState<GraphTable | null>(null);
  const [tableDescription, setTableDescription] = useState("");
  const [savingTable, setSavingTable] = useState(false);
  const [columnsTable, setColumnsTable] = useState<GraphTable | null>(null);
  const [columns, setColumns] = useState<GraphColumn[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [columnsError, setColumnsError] = useState("");
  const [columnToEdit, setColumnToEdit] = useState<GraphColumn | null>(null);
  const [columnDescription, setColumnDescription] = useState("");
  const [columnSynonyms, setColumnSynonyms] = useState("");
  const [savingColumn, setSavingColumn] = useState(false);

  const { reload: reloadSchema } = schema;
  const configuredDatabaseNames = useMemo(
    () => new Set(schema.groups.map(([database]) => database)),
    [schema.groups],
  );

  useEffect(() => {
    void reloadSchema();
  }, [reloadSchema]);

  const openAddDatabaseDialog = () => {
    setEditingDatabase("");
    setDialogOpen(true);
  };

  const openManageDatabaseDialog = (database: string) => {
    setEditingDatabase(database);
    setDialogOpen(true);
  };

  const removeDatabase = async () => {
    if (!databaseToRemove) return;

    setRemovingDatabase(true);
    schema.setError("");

    try {
      await removeGraphDatabase(databaseToRemove);
      setDatabaseToRemove("");
      onGraphChanged();
      await schema.reload();
    } catch (err) {
      schema.setError(getErrorMessage(err, "Could not remove database."));
    } finally {
      setRemovingDatabase(false);
    }
  };

  const syncDatabase = async (
    database: string,
    dialect: string,
    currentTables: GraphTable[],
  ) => {
    setSyncingDatabase(database);
    schema.setError("");

    try {
      const availableTables = await fetchTables(dialect, database);
      const selectedKeys = new Set(
        currentTables.map((table) =>
          getTableKey({
            database: table.database,
            schema: table.schema,
            name: table.name,
          }),
        ),
      );
      const tablesToSync = availableTables.filter((table) =>
        selectedKeys.has(getTableKey(table)),
      );

      if (tablesToSync.length === 0) {
        throw new Error(
          "None of the selected tables are available anymore. Use Manage Tables to update this dataset.",
        );
      }

      await syncGraphDatabase(database, dialect, tablesToSync);
      onGraphChanged();
      await schema.reload();
    } catch (err) {
      schema.setError(getErrorMessage(err, `Could not sync ${database}.`));
    } finally {
      setSyncingDatabase("");
    }
  };

  const openTableEdit = (table: GraphTable) => {
    setTableToEdit(table);
    setTableDescription(table.description);
  };

  const saveTableDescription = async () => {
    if (!tableToEdit) return;

    setSavingTable(true);
    schema.setError("");

    try {
      await updateTableDescription(tableToEdit.fullName, tableDescription);

      schema.setTables((current) =>
        current.map((table) =>
          table.fullName === tableToEdit.fullName
            ? { ...table, description: tableDescription }
            : table,
        ),
      );
      setTableToEdit(null);
    } catch (err) {
      schema.setError(
        getErrorMessage(err, "Could not save table description."),
      );
    } finally {
      setSavingTable(false);
    }
  };

  const openColumns = async (table: GraphTable) => {
    setColumnsTable(table);
    setColumns([]);
    setColumnsError("");
    setColumnsLoading(true);

    try {
      setColumns(await fetchColumns(table.fullName));
    } catch (err) {
      setColumnsError(getErrorMessage(err, "Could not load columns."));
    } finally {
      setColumnsLoading(false);
    }
  };

  const openColumnEdit = (column: GraphColumn) => {
    setColumnToEdit(column);
    setColumnDescription(column.description);
    setColumnSynonyms(column.synonyms.join(", "));
  };

  const saveColumnDescription = async () => {
    if (!columnToEdit) return;

    setSavingColumn(true);
    setColumnsError("");

    try {
      const synonyms = parseSynonyms(columnSynonyms);

      await updateColumnDescription(
        columnToEdit.fullName,
        columnDescription,
        synonyms,
      );

      setColumns((current) =>
        current.map((column) =>
          column.fullName === columnToEdit.fullName
            ? { ...column, description: columnDescription, synonyms }
            : column,
        ),
      );
      setColumnToEdit(null);
      setColumnSynonyms("");
    } catch (err) {
      setColumnsError(
        getErrorMessage(err, "Could not save column description."),
      );
    } finally {
      setSavingColumn(false);
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-auto p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Datasets</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Warehouse schemas stored as OKF bundles and table concepts.
          </p>
        </div>
        <div className="flex gap-2">
          <DatasetDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            editingDatabase={editingDatabase}
            configuredTables={schema.tables}
            configuredDatabaseNames={configuredDatabaseNames}
            onSaved={async () => {
              onGraphChanged();
              await schema.reload();
            }}
          />
          <Button
            variant="outline"
            onClick={openAddDatabaseDialog}
            disabled={syncingDatabase.length > 0}
          >
            <PlusIcon className="size-4" />
            Add Dataset
          </Button>
          <Button
            variant="outline"
            onClick={() => void schema.reload()}
            disabled={schema.loading}
          >
            {schema.loading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RotateCcwIcon className="size-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <ErrorMessage message={schema.error} />

      <div className="max-h-[calc(100dvh-15rem)] space-y-3 overflow-auto">
        {schema.loading ? (
          <div className="overflow-hidden rounded-md border">
            <LoadingRow label="Loading datasets" />
          </div>
        ) : schema.groups.length === 0 ? (
          <div className="rounded-md border px-4 py-12 text-center">
            <DatabaseIcon className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No datasets added</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a Snowflake database or Databricks catalog as a dataset, then
              choose tables from one or more schemas.
            </p>
            <Button className="mt-4" onClick={openAddDatabaseDialog}>
              <PlusIcon className="size-4" />
              Add Dataset
            </Button>
          </div>
        ) : (
          schema.groups.map(([database, databaseTables]) => (
            <section
              key={database}
              className="overflow-hidden rounded-md border"
            >
              <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <DatasetDialectIcon
                    dialect={databaseTables[0]?.dialect ?? "Snowflake"}
                    className="size-4 shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">
                      {database}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {databaseTables[0]?.dialect ?? "Snowflake"} ·{" "}
                      {databaseTables.length} table
                      {databaseTables.length === 1 ? "" : "s"} across{" "}
                      {new Set(databaseTables.map((table) => table.schema)).size}{" "}
                      schema
                      {new Set(databaseTables.map((table) => table.schema))
                        .size === 1
                        ? ""
                        : "s"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void syncDatabase(
                        database,
                        databaseTables[0]?.dialect ?? "Snowflake",
                        databaseTables,
                      )
                    }
                    disabled={syncingDatabase.length > 0 || removingDatabase}
                  >
                    {syncingDatabase === database ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <RotateCcwIcon className="size-4" />
                    )}
                    Sync
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openManageDatabaseDialog(database)}
                    disabled={syncingDatabase.length > 0}
                  >
                    <Edit3Icon className="size-4" />
                    Manage Tables
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDatabaseToRemove(database)}
                    aria-label={`Remove ${database}`}
                    disabled={syncingDatabase.length > 0}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </div>

              {groupGraphTablesBySchema(databaseTables).map(
                ([schemaName, schemaTableItems]) => (
                  <div key={schemaName} className="border-b last:border-b-0">
                    <div className="bg-muted/15 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                      {schemaName}
                    </div>
                    {schemaTableItems.map((table) => (
                      <div
                        key={table.fullName}
                        className="grid grid-cols-[minmax(14rem,1fr)_minmax(16rem,1.4fr)_6rem_11rem] items-center gap-3 border-t px-3 py-2.5"
                      >
                        <div className="truncate text-sm font-medium">
                          {table.name}
                        </div>
                        <div className="line-clamp-2 text-sm text-muted-foreground">
                          {table.description || "No description"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {table.columnCount} columns
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openTableEdit(table)}
                          >
                            <Edit3Icon className="size-4" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void openColumns(table)}
                          >
                            <Columns3Icon className="size-4" />
                            Columns
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ),
              )}
            </section>
          ))
        )}
      </div>

      <Dialog
        open={databaseToRemove.length > 0}
        onOpenChange={(open) => {
          if (!open && !removingDatabase) setDatabaseToRemove("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove dataset?</DialogTitle>
            <DialogDescription>
              This removes {databaseToRemove} and its app-managed OKF bundle.
              Other bundles and references remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDatabaseToRemove("")}
              disabled={removingDatabase}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void removeDatabase()}
              disabled={removingDatabase}
            >
              {removingDatabase ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <Trash2Icon className="size-4" />
              )}
              Remove Dataset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tableToEdit !== null}
        onOpenChange={(open) => {
          if (!open) setTableToEdit(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit table description</DialogTitle>
            <DialogDescription>{tableToEdit?.name}</DialogDescription>
          </DialogHeader>
          <textarea
            value={tableDescription}
            onChange={(event) => setTableDescription(event.target.value)}
            className="min-h-32 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTableToEdit(null)}
              disabled={savingTable}
            >
              Cancel
            </Button>
            <Button onClick={saveTableDescription} disabled={savingTable}>
              {savingTable ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <CheckIcon className="size-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={columnsTable !== null}
        onOpenChange={(open) => {
          if (!open) {
            setColumnsTable(null);
            setColumnToEdit(null);
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{columnsTable?.name}</DialogTitle>
            <DialogDescription>
              Columns and descriptions from the knowledge graph.
            </DialogDescription>
          </DialogHeader>

          <ErrorMessage message={columnsError} />

          <div className="overflow-hidden rounded-md border">
            <div className="grid grid-cols-[minmax(12rem,1fr)_8rem_minmax(14rem,1.1fr)_minmax(12rem,1fr)_5rem] border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
              <span>Column</span>
              <span>Type</span>
              <span>Description</span>
              <span>Synonyms</span>
              <span className="text-right">Edit</span>
            </div>
            <div className="max-h-[26rem] overflow-auto">
              {columnsLoading ? (
                <LoadingRow label="Loading columns" />
              ) : columns.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No columns found.
                </div>
              ) : (
                columns.map((column) => (
                  <div
                    key={column.fullName}
                    className="grid grid-cols-[minmax(12rem,1fr)_8rem_minmax(14rem,1.1fr)_minmax(12rem,1fr)_5rem] items-center gap-3 border-b px-3 py-3 last:border-b-0"
                  >
                    <span className="truncate text-sm font-medium">
                      {column.name}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {column.dataType}
                    </span>
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {column.description || "No description"}
                    </span>
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {column.synonyms.length > 0
                        ? column.synonyms.join(", ")
                        : "No synonyms"}
                    </span>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openColumnEdit(column)}
                      >
                        <Edit3Icon className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={columnToEdit !== null}
        onOpenChange={(open) => {
          if (!open) {
            setColumnToEdit(null);
            setColumnSynonyms("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit column description</DialogTitle>
            <DialogDescription>{columnToEdit?.name}</DialogDescription>
          </DialogHeader>
          <textarea
            value={columnDescription}
            onChange={(event) => setColumnDescription(event.target.value)}
            className="min-h-32 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="space-y-2">
            <label className="text-sm font-medium">Synonyms</label>
            <input
              value={columnSynonyms}
              onChange={(event) => setColumnSynonyms(event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="revenue, sales, turnover"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setColumnToEdit(null)}
              disabled={savingColumn}
            >
              Cancel
            </Button>
            <Button onClick={saveColumnDescription} disabled={savingColumn}>
              {savingColumn ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <CheckIcon className="size-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
