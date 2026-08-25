"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  FileTextIcon,
  Loader2Icon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

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
  deleteReference,
  fetchDomainKnowledge,
  getErrorMessage,
  updateReferenceDatasets,
  uploadDomainKnowledge,
} from "@/components/graph/api";
import { DatasetDialectIcon } from "@/components/graph/dialects";
import { ErrorMessage } from "@/components/graph/feedback";
import type {
  DomainKnowledgeDocument,
  DomainKnowledgeUploadResult,
  GraphChangeHandler,
} from "@/components/graph/types";
import type { SchemaTablesStore } from "@/components/graph/use-schema-tables";
import { formatDateTime } from "@/components/graph/utils";

export function ReferencesTab({
  schema,
  onGraphChanged,
}: {
  schema: SchemaTablesStore;
  onGraphChanged: GraphChangeHandler;
}) {
  const [documents, setDocuments] = useState<DomainKnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadResult, setUploadResult] = useState<
    DomainKnowledgeUploadResult["document"] | null
  >(null);
  const [file, setFile] = useState<File | null>(null);
  const [referenceToMap, setReferenceToMap] =
    useState<DomainKnowledgeDocument | null>(null);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [savingDatasets, setSavingDatasets] = useState(false);
  const [referenceToDelete, setReferenceToDelete] =
    useState<DomainKnowledgeDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { loading: schemaLoading, tables: schemaTables, reload: reloadSchema } =
    schema;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      setDocuments(await fetchDomainKnowledge());
    } catch (err) {
      setError(getErrorMessage(err, "Could not load references."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (schemaTables.length > 0 || schemaLoading) return;
    // The mapping dialog lists datasets, so they must be loaded even when this
    // is the first tab opened.
    void reloadSchema();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError("");
    setUploadResult(null);

    try {
      const data = await uploadDomainKnowledge(file);
      setDocuments(data.documents);
      setUploadResult(data.document);
      setFile(null);
      onGraphChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Could not add reference."));
    } finally {
      setUploading(false);
    }
  };

  const openReferenceMapping = (reference: DomainKnowledgeDocument) => {
    setReferenceToMap(reference);
    setSelectedDatasets(reference.datasetNames);
    setError("");
  };

  const saveReferenceDatasets = async () => {
    if (!referenceToMap) return;

    setSavingDatasets(true);
    setError("");

    try {
      const data = await updateReferenceDatasets(
        referenceToMap.filename,
        selectedDatasets,
      );
      setDocuments(data.documents);
      setReferenceToMap(null);
    } catch (err) {
      setError(getErrorMessage(err, "Could not update reference datasets."));
    } finally {
      setSavingDatasets(false);
    }
  };

  const handleDelete = async () => {
    if (!referenceToDelete) return;

    setDeleting(true);
    setError("");

    try {
      const data = await deleteReference(referenceToDelete.filename);
      setDocuments(data.documents);
      setUploadResult(null);
      setReferenceToDelete(null);
      onGraphChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Could not delete reference."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-auto p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">References</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload Markdown as OKF Reference concepts or map it to datasets.
            Content is split into the same ordered H1 sections used by retrieval.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <RotateCcwIcon className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      <ErrorMessage message={error} />

      {uploadResult ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          Added {uploadResult.title} with {uploadResult.chunkCount} OKF sections.
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-md border p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <UploadIcon className="size-4" />
          Upload Markdown
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setUploadResult(null);
            }}
          />
          <Button onClick={() => void handleUpload()} disabled={!file || uploading}>
            {uploading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <UploadIcon className="size-4" />
            )}
            Add Reference
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          References upload globally. Map them to one or more datasets
          afterwards. Re-uploading preserves the existing mappings.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-[1fr_minmax(10rem,auto)_auto_auto_auto] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Reference</span>
          <span>Datasets</span>
          <span>Chunks</span>
          <span>Updated</span>
          <span className="sr-only">Actions</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="mr-2 size-4 animate-spin" />
            Loading references...
          </div>
        ) : documents.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Markdown references added yet.
          </div>
        ) : (
          documents.map((document) => (
            <div
              key={document.filename}
              className="grid grid-cols-[1fr_minmax(10rem,auto)_auto_auto_auto] items-center gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">
                    {document.title}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {document.filename} · {document.contentLength} chars
                </p>
              </div>
              <span className="max-w-64 truncate text-sm text-muted-foreground">
                {document.datasetNames.length > 0
                  ? document.datasetNames.join(", ")
                  : "Global"}
              </span>
              <span className="text-sm text-muted-foreground">
                {document.chunkCount}
              </span>
              <span className="text-sm text-muted-foreground">
                {formatDateTime(document.updatedAt)}
              </span>
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openReferenceMapping(document)}
                >
                  Map Datasets
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setReferenceToDelete(document)}
                  aria-label={`Delete ${document.title}`}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={referenceToMap !== null}
        onOpenChange={(open) => {
          if (!open && !savingDatasets) setReferenceToMap(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Map reference to datasets</DialogTitle>
            <DialogDescription>
              {referenceToMap?.title}. Leave every dataset unchecked to keep this
              reference global.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-1 overflow-auto rounded-md border p-2">
            {schema.groups.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                No datasets available.
              </p>
            ) : (
              schema.groups.map(([database, databaseTables]) => {
                const checked = selectedDatasets.includes(database);

                return (
                  <label
                    key={database}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        setSelectedDatasets((current) =>
                          checked
                            ? current.filter((name) => name !== database)
                            : [...current, database],
                        )
                      }
                      disabled={savingDatasets}
                    />
                    <DatasetDialectIcon
                      dialect={databaseTables[0]?.dialect ?? "Snowflake"}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {database}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReferenceToMap(null)}
              disabled={savingDatasets}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveReferenceDatasets()}
              disabled={savingDatasets}
            >
              {savingDatasets ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <CheckIcon className="size-4" />
              )}
              Save Mappings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={referenceToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setReferenceToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete reference?</DialogTitle>
            <DialogDescription>
              This permanently removes {referenceToDelete?.title}, all of its
              OKF sections, and its dataset mappings from Neo4j.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReferenceToDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <Trash2Icon className="size-4" />
              )}
              Delete Reference
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
