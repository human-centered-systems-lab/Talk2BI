"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  DownloadIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/assistant-ui/page-header";
import { cn } from "@/lib/utils";

type EvaluationRow = {
  id: string;
  question: string;
  goldSql: string;
};

type EvaluationRun = {
  id: string;
  caseId: string;
  question: string;
  goldSql: string;
  answerText: string | null;
  resultText?: string | null;
  finalSql: string | null;
  executedSql: string | null;
  status: "success" | "error";
  error: string | null;
  createdAt: string;
};

const emptyRow: EvaluationRow = {
  id: "",
  question: "",
  goldSql: "",
};

export default function EvaluationPage() {
  const [hydrated, setHydrated] = useState(false);
  const [rows, setRows] = useState<EvaluationRow[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [draft, setDraft] = useState<EvaluationRow>(emptyRow);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EvaluationRow>(emptyRow);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [lastRunAllRuns, setLastRunAllRuns] = useState<EvaluationRun[]>([]);
  const [runAllProgress, setRunAllProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  const trimmedDraft = useMemo(
    () => ({
      id: draft.id.trim(),
      question: draft.question.trim(),
      goldSql: draft.goldSql.trim(),
    }),
    [draft],
  );

  const latestRunsByCaseId = useMemo(() => {
    const latest = new Map<string, EvaluationRun>();

    runs.forEach((run) => {
      const current = latest.get(run.caseId);
      if (!current || run.createdAt > current.createdAt) {
        latest.set(run.caseId, run);
      }
    });

    return latest;
  }, [runs]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    Promise.all([
      fetch("/api/evaluation-cases", { cache: "no-store" }).then((res) =>
        readJson<EvaluationRow[]>(res),
      ),
      fetch("/api/evaluation-runs", { cache: "no-store" }).then((res) =>
        readJson<EvaluationRun[]>(res),
      ),
    ])
      .then(([cases, loadedRuns]) => {
        if (!active) return;
        setRows(cases);
        setRuns(loadedRuns);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "Could not load evaluation cases.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const addRow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!trimmedDraft.id || !trimmedDraft.question || !trimmedDraft.goldSql) {
      setError("Add an id, question, and gold SQL statement.");
      return;
    }

    if (rows.some((row) => row.id === trimmedDraft.id)) {
      setError("This id already exists in the evaluation table.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const created = await fetch("/api/evaluation-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmedDraft),
      }).then((res) => readJson<EvaluationRow>(res));

      setRows((current) => [...current, created]);
      setDraft(emptyRow);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not add evaluation case.",
      );
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (row: EvaluationRow) => {
    setEditingId(row.id);
    setEditDraft(row);
    setError("");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditDraft(emptyRow);
  };

  const saveRow = async (id: string) => {
    const input = {
      question: editDraft.question.trim(),
      goldSql: editDraft.goldSql.trim(),
    };

    if (!input.question || !input.goldSql) {
      setError("Add a question and gold SQL statement.");
      return;
    }

    setSavingEditId(id);
    setError("");

    try {
      const updated = await fetch(
        `/api/evaluation-cases/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      ).then((res) => readJson<EvaluationRow>(res));

      setRows((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      setEditingId(null);
      setEditDraft(emptyRow);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update evaluation case.",
      );
    } finally {
      setSavingEditId(null);
    }
  };

  const removeRow = async (id: string) => {
    setDeletingId(id);
    setError("");

    try {
      const res = await fetch(
        `/api/evaluation-cases/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Could not delete evaluation case.");
      }

      setRows((current) => current.filter((row) => row.id !== id));
      setRuns((current) => current.filter((run) => run.caseId !== id));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not delete evaluation case.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const runCase = async (id: string) => {
    return fetch(
      `/api/evaluation-cases/${encodeURIComponent(id)}/runs`,
      { method: "POST" },
    ).then((res) => readJson<EvaluationRun>(res));
  };

  const runEvaluation = async (id: string) => {
    setRunningId(id);
    setError("");

    try {
      const run = await runCase(id);

      setRuns((current) => [run, ...current]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not run evaluation.",
      );
    } finally {
      setRunningId(null);
    }
  };

  const runAllEvaluations = async () => {
    if (rows.length === 0) return;

    setRunningAll(true);
    setRunAllProgress({ completed: 0, total: rows.length });
    setLastRunAllRuns([]);
    setError("");

    try {
      const completedRuns: EvaluationRun[] = [];

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        setRunningId(row.id);

        const run = await runCase(row.id);
        completedRuns.push(run);
        setRuns((current) => [run, ...current]);
        setRunAllProgress({
          completed: index + 1,
          total: rows.length,
        });
      }

      setLastRunAllRuns(completedRuns);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not complete evaluation run.",
      );
    } finally {
      setRunningId(null);
      setRunningAll(false);
      setRunAllProgress(null);
    }
  };

  const deleteRun = async (id: string) => {
    setDeletingRunId(id);
    setError("");

    try {
      const res = await fetch(
        `/api/evaluation-runs?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Could not delete evaluation run.");
      }

      setRuns((current) => current.filter((run) => run.id !== id));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not delete evaluation run.",
      );
    } finally {
      setDeletingRunId(null);
    }
  };

  return (
    // AppShell's SidebarInset is `overflow-hidden`, so a route that outgrows the
    // viewport has to scroll itself — this <main> is the element with a bounded
    // height, which makes it the scroll container.
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Evaluation</h1>
          <p className="text-sm text-muted-foreground">
            Build a small gold SQL set for later answer evaluation.
          </p>
        </div>

        <form
          onSubmit={addRow}
          className="grid gap-4 rounded-md border bg-card p-4 shadow-sm"
        >
          <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
            <div className="grid gap-2">
              <Label htmlFor="evaluation-id">ID</Label>
              <Input
                id="evaluation-id"
                value={draft.id}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    id: event.target.value,
                  }))
                }
                placeholder="vat-enbw-001"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="evaluation-question">Question</Label>
              <Input
                id="evaluation-question"
                value={draft.question}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    question: event.target.value,
                  }))
                }
                placeholder="What is the VAT number of EnBW Energie Baden-Württemberg AG?"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="evaluation-gold-sql">Gold SQL</Label>
            <textarea
              id="evaluation-gold-sql"
              value={draft.goldSql}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  goldSql: event.target.value,
                }))
              }
              placeholder="SELECT ..."
              className={cn(
                "min-h-32 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm transition-colors",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-destructive" aria-live="polite">
              {error}
            </p>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              {saving ? "Adding..." : "Add case"}
            </Button>
          </div>
        </form>

        <section className="overflow-hidden rounded-md border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-medium">Evaluation cases</h2>
              <span className="text-xs text-muted-foreground">
                {rows.length} {rows.length === 1 ? "case" : "cases"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {runAllProgress ? (
                <span className="text-xs text-muted-foreground">
                  {runAllProgress.completed}/{runAllProgress.total} complete
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={runAllEvaluations}
                disabled={
                  hydrated
                    ? loading || rows.length === 0 || runningAll
                    : undefined
                }
              >
                {runningAll ? <Loader2Icon className="animate-spin" /> : null}
                {runningAll ? "Running..." : "Run all"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadEvaluationBundle(lastRunAllRuns)}
                disabled={lastRunAllRuns.length === 0 || runningAll}
              >
                <DownloadIcon className="size-4" />
                Download all
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-44 px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Question</th>
                  <th className="px-4 py-3 font-medium">Gold SQL</th>
                  <th className="w-32 px-4 py-3 font-medium">Latest run</th>
                  <th className="w-24 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      Loading evaluation cases...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      No evaluation cases yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const latestRun = latestRunsByCaseId.get(row.id);
                    const isEditing = editingId === row.id;

                    return (
                      <tr key={row.id} className="border-b last:border-b-0">
                        <td className="align-top px-4 py-3 font-mono text-xs">
                          {row.id}
                        </td>
                        <td className="max-w-md align-top px-4 py-3">
                          {isEditing ? (
                            <Input
                              value={editDraft.question}
                              onChange={(event) =>
                                setEditDraft((current) => ({
                                  ...current,
                                  question: event.target.value,
                                }))
                              }
                              aria-label={`Question for ${row.id}`}
                            />
                          ) : (
                            row.question
                          )}
                        </td>
                        <td className="align-top px-4 py-3">
                          {isEditing ? (
                            <textarea
                              value={editDraft.goldSql}
                              onChange={(event) =>
                                setEditDraft((current) => ({
                                  ...current,
                                  goldSql: event.target.value,
                                }))
                              }
                              aria-label={`Gold SQL for ${row.id}`}
                              className={cn(
                                "min-h-32 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm transition-colors",
                                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                              )}
                            />
                          ) : (
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-xs">
                              {row.goldSql}
                            </pre>
                          )}
                        </td>
                        <td className="align-top px-4 py-3">
                          {latestRun ? (
                            <div className="space-y-1 text-xs">
                              <span
                                className={cn(
                                  "inline-flex rounded px-2 py-0.5 font-medium",
                                  latestRun.status === "success"
                                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                    : "bg-destructive/10 text-destructive",
                                )}
                              >
                                {latestRun.status}
                              </span>
                              <div className="text-muted-foreground">
                                {new Date(latestRun.createdAt).toLocaleString()}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Not run
                            </span>
                          )}
                        </td>
                        <td className="align-top px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {isEditing ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => saveRow(row.id)}
                                  disabled={savingEditId === row.id}
                                >
                                  {savingEditId === row.id ? (
                                    <Loader2Icon className="animate-spin" />
                                  ) : (
                                    <SaveIcon />
                                  )}
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={cancelEditing}
                                  disabled={savingEditId === row.id}
                                  aria-label={`Cancel editing ${row.id}`}
                                >
                                  <XIcon />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => runEvaluation(row.id)}
                                  disabled={
                                    runningAll ||
                                    runningId === row.id ||
                                    editingId !== null
                                  }
                                >
                                  {runningId === row.id ? (
                                    <Loader2Icon className="animate-spin" />
                                  ) : null}
                                  Run
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => startEditing(row)}
                                  disabled={runningAll || editingId !== null}
                                  aria-label={`Edit ${row.id}`}
                                >
                                  <PencilIcon />
                                </Button>
                              </>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeRow(row.id)}
                              disabled={
                                runningAll ||
                                deletingId === row.id ||
                                editingId !== null
                              }
                              aria-label={`Remove ${row.id}`}
                            >
                              {deletingId === row.id ? (
                                <Loader2Icon className="animate-spin" />
                              ) : (
                                <Trash2Icon />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
            <h2 className="text-sm font-medium">Evaluation runs</h2>
            <span className="text-xs text-muted-foreground">
              {runs.length} {runs.length === 1 ? "run" : "runs"}
            </span>
          </div>

          <div className="divide-y">
            {runs.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No evaluation runs yet.
              </div>
            ) : (
              runs.map((run) => {
                const resultText =
                  run.resultText ?? extractResultText(run.answerText);
                const resultRows = parseMarkdownTable(resultText);

                return (
                  <article key={run.id} className="grid gap-4 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{run.caseId}</span>
                          <span
                            className={cn(
                              "rounded px-2 py-0.5 text-xs font-medium",
                              run.status === "success"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "bg-destructive/10 text-destructive",
                            )}
                          >
                            {run.status}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {new Date(run.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadRunSql(run)}
                          disabled={!run.finalSql}
                        >
                          <DownloadIcon className="size-4" />
                          SQL
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadRunResultCsv(run, resultRows)}
                          disabled={resultRows.length === 0}
                        >
                          <DownloadIcon className="size-4" />
                          CSV
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void deleteRun(run.id)}
                          disabled={deletingRunId === run.id}
                        >
                          {deletingRunId === run.id ? (
                            <Loader2Icon className="size-4 animate-spin" />
                          ) : (
                            <Trash2Icon className="size-4" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <SqlPanel title="Gold SQL" sql={run.goldSql} />
                      <ResultPanel result={resultText} />
                      <SqlPanel title="Final SQL" sql={run.finalSql} />
                      <SqlPanel title="Executed SQL" sql={run.executedSql} />
                      <div className="rounded-md border bg-card p-3">
                        <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                          Answer
                        </h3>
                        <p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">
                          {run.error ?? run.answerText ?? "No answer captured."}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function SqlPanel({ title, sql }: { title: string; sql: string | null }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
        {title}
      </h3>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-xs">
        {sql ?? "Not captured."}
      </pre>
    </div>
  );
}

function ResultPanel({ result }: { result: string | null }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
        Result
      </h3>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-xs">
        {result ?? "Not captured."}
      </pre>
    </div>
  );
}

function extractResultText(answerText: string | null) {
  if (!answerText) return null;

  const resultMatch = answerText.match(
    /(?:^|\n)#{1,6}\s*Result\s*\n+([\s\S]*?)(?=\n#{1,6}\s*Final SQL\s*\n|$)/i,
  );

  return resultMatch?.[1]?.trim() ?? null;
}

function parseMarkdownTable(markdown: string | null): string[][] {
  if (!markdown) return [];

  const tableLines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (tableLines.length < 2) return [];

  const rows = tableLines
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );

  return rows.length > 1 ? rows : [];
}

function toCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
}

function downloadRunSql(run: EvaluationRun) {
  if (!run.finalSql) return;

  downloadTextFile(
    `${sanitizeFilename(run.caseId)}.sql`,
    `${run.finalSql}\n`,
    "application/sql;charset=utf-8",
  );
}

function downloadRunResultCsv(run: EvaluationRun, rows: string[][]) {
  if (rows.length === 0) return;

  downloadTextFile(
    `${sanitizeFilename(run.caseId)}.csv`,
    toCsv(rows),
    "text/csv;charset=utf-8",
  );
}

async function downloadEvaluationBundle(runs: EvaluationRun[]) {
  if (runs.length === 0) return;

  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  const folder = `evaluation-results-${timestamp}`;
  const files = runs.flatMap((run) => {
    const caseId = sanitizeFilename(run.caseId);
    const resultText = run.resultText ?? extractResultText(run.answerText);
    const resultRows = parseMarkdownTable(resultText);

    return [
      {
        path: `${folder}/${caseId}.sql`,
        content: run.finalSql ? `${run.finalSql}\n` : "",
      },
      {
        path: `${folder}/${caseId}.csv`,
        content: toCsv(resultRows),
      },
    ];
  });
  const blob = createZipBlob(files);

  downloadBlob(blob, `${folder}.zip`);
}

function downloadTextFile(filename: string, content: string, type: string) {
  downloadBlob(new Blob([content], { type }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || "evaluation-case";
}

type ZipFile = {
  path: string;
  content: string;
};

function createZipBlob(files: ZipFile[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const filename = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const crc = crc32(content);
    const localHeader = createZipLocalHeader(filename, content, crc);
    const centralHeader = createZipCentralHeader(
      filename,
      content,
      crc,
      offset,
    );

    localParts.push(localHeader, content);
    centralParts.push(centralHeader);
    offset += localHeader.length + content.length;
  });

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce(
    (total, part) => total + part.length,
    0,
  );
  const endRecord = createZipEndRecord(
    files.length,
    centralDirectorySize,
    centralDirectoryOffset,
  );
  const zipBytes = concatBytes([...localParts, ...centralParts, endRecord]);
  const zipBuffer = zipBytes.buffer.slice(
    zipBytes.byteOffset,
    zipBytes.byteOffset + zipBytes.byteLength,
  ) as ArrayBuffer;

  return new Blob([zipBuffer], {
    type: "application/zip",
  });
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

function createZipLocalHeader(
  filename: Uint8Array,
  content: Uint8Array,
  crc: number,
) {
  const header = new Uint8Array(30 + filename.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, getZipTime(), true);
  view.setUint16(12, getZipDate(), true);
  view.setUint32(14, crc, true);
  view.setUint32(18, content.length, true);
  view.setUint32(22, content.length, true);
  view.setUint16(26, filename.length, true);
  view.setUint16(28, 0, true);
  header.set(filename, 30);

  return header;
}

function createZipCentralHeader(
  filename: Uint8Array,
  content: Uint8Array,
  crc: number,
  localHeaderOffset: number,
) {
  const header = new Uint8Array(46 + filename.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, getZipTime(), true);
  view.setUint16(14, getZipDate(), true);
  view.setUint32(16, crc, true);
  view.setUint32(20, content.length, true);
  view.setUint32(24, content.length, true);
  view.setUint16(28, filename.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);
  header.set(filename, 46);

  return header;
}

function createZipEndRecord(
  fileCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return record;
}

function getZipTime() {
  const date = new Date();

  return (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  );
}

function getZipDate() {
  const date = new Date();

  return (
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array) {
  const table = getCrcTable();
  let crc = 0xffffffff;

  bytes.forEach((byte) => {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  });

  return (crc ^ 0xffffffff) >>> 0;
}

function getCrcTable() {
  if (crcTable) return crcTable;

  crcTable = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    crcTable[index] = value >>> 0;
  }

  return crcTable;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = parseJson(text);

  if (!res.ok) {
    const message =
      getResponseError(data) ||
      text ||
      `${res.status} ${res.statusText || "Request failed"}`;

    throw new Error(message);
  }

  return data as T;
}

function parseJson(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getResponseError(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    return typeof error === "string" ? error : null;
  }

  return null;
}
