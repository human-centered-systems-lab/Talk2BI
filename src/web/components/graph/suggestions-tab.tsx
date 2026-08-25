"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  Edit3Icon,
  Loader2Icon,
  RotateCcwIcon,
  SparklesIcon,
  TelescopeIcon,
  Trash2Icon,
} from "lucide-react";

import { useModel } from "@/components/model-provider";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteAppSuggestion,
  fetchAppSuggestions,
  generateAppSuggestions,
  getErrorMessage,
  updateAppSuggestion,
} from "@/components/graph/api";
import { ErrorMessage, LoadingRow } from "@/components/graph/feedback";
import type {
  AppSuggestion,
  GraphChangeHandler,
} from "@/components/graph/types";
import { cn } from "@/lib/utils";

function SuggestionModelIcon({
  option,
  className,
}: {
  option?: {
    iconUrl?: string;
    invertIconInDarkMode?: boolean;
  };
  className?: string;
}) {
  if (option?.iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={option.iconUrl}
        alt=""
        className={cn(
          "object-contain",
          option.invertIconInDarkMode && "dark:invert",
          className,
        )}
      />
    );
  }

  return <TelescopeIcon className={className} />;
}

export function SuggestionsTab({
  onGraphChanged,
}: {
  onGraphChanged: GraphChangeHandler;
}) {
  const { model, models, setModel } = useModel();
  const [suggestions, setSuggestions] = useState<AppSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [suggestionToEdit, setSuggestionToEdit] =
    useState<AppSuggestion | null>(null);
  const [draft, setDraft] = useState({ category: "", label: "", prompt: "" });
  const [saving, setSaving] = useState(false);

  const groups = useMemo(() => {
    const grouped = new Map<string, AppSuggestion[]>();
    suggestions.forEach((suggestion) => {
      const items = grouped.get(suggestion.category) ?? [];
      items.push(suggestion);
      grouped.set(suggestion.category, items);
    });
    return Array.from(grouped.entries());
  }, [suggestions]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSuggestions(await fetchAppSuggestions());
    } catch (err) {
      setError(getErrorMessage(err, "Could not load suggestions."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGenerate = async () => {
    if (!model) return;
    setGenerating(true);
    setError("");
    try {
      setSuggestions(await generateAppSuggestions(model));
      onGraphChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Could not generate suggestions."));
    } finally {
      setGenerating(false);
    }
  };

  const openSuggestionEdit = (suggestion: AppSuggestion) => {
    setSuggestionToEdit(suggestion);
    setDraft({
      category: suggestion.category,
      label: suggestion.label,
      prompt: suggestion.prompt,
    });
    setError("");
  };

  const saveSuggestion = async () => {
    if (!suggestionToEdit) return;
    setSaving(true);
    setError("");
    try {
      setSuggestions(
        await updateAppSuggestion({ ...suggestionToEdit, ...draft }),
      );
      setSuggestionToEdit(null);
      onGraphChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Could not save suggestion."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError("");
    try {
      await deleteAppSuggestion(id);
      setSuggestions((current) =>
        current.filter((suggestion) => suggestion.id !== id),
      );
      onGraphChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Could not delete suggestion."));
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-auto p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Suggestions</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Generate starter questions from table and column metadata embedded
            in the app-managed OKF concepts. Suggestions are stored in the graph
            and shown on a new chat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="max-w-56 justify-between gap-2"
                disabled={!model || generating}
              >
                <SuggestionModelIcon
                  option={models.find((option) => option.id === model)}
                  className="size-4 shrink-0"
                />
                <span className="truncate">{model ?? "Loading model..."}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuRadioGroup
                value={model ?? ""}
                onValueChange={setModel}
              >
                {models.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.id}
                    value={option.id}
                    className="gap-2"
                  >
                    <SuggestionModelIcon
                      option={option}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate">{option.id}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={() => void handleGenerate()}
            disabled={!model || generating}
          >
            {generating ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SparklesIcon className="size-4" />
            )}
            {suggestions.length > 0 ? "Regenerate" : "Generate Suggestions"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => void load()}
            disabled={loading || generating}
            aria-label="Refresh suggestions"
          >
            {loading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RotateCcwIcon className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Generation reads the structured metadata inside table concepts directly;
        it does not run the retrieval agent. Regenerating replaces the current
        stored suggestions, including manual edits.
      </div>

      <ErrorMessage message={error} />

      {loading ? (
        <div className="overflow-hidden rounded-md border">
          <LoadingRow label="Loading suggestions" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-md border px-4 py-14 text-center">
          <SparklesIcon className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium">No suggestions generated</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a model and generate questions grounded in your added
            datasets.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map(([category, categorySuggestions]) => (
            <section
              key={category}
              className="overflow-hidden rounded-md border"
            >
              <div className="border-b bg-muted/30 px-4 py-2.5">
                <h3 className="text-sm font-semibold">{category}</h3>
              </div>
              {categorySuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{suggestion.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {suggestion.prompt}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openSuggestionEdit(suggestion)}
                      aria-label={`Edit ${suggestion.label}`}
                    >
                      <Edit3Icon className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDelete(suggestion.id)}
                      aria-label={`Delete ${suggestion.label}`}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      <Dialog
        open={suggestionToEdit !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setSuggestionToEdit(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit suggestion</DialogTitle>
            <DialogDescription>
              Changes are stored for this app and appear in new chats.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Category</span>
              <input
                value={draft.category}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                maxLength={40}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Label</span>
              <input
                value={draft.label}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                maxLength={60}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Prompt</span>
              <textarea
                value={draft.prompt}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    prompt: event.target.value,
                  }))
                }
                className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                maxLength={500}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSuggestionToEdit(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveSuggestion()}
              disabled={
                saving ||
                !draft.category.trim() ||
                !draft.label.trim() ||
                !draft.prompt.trim()
              }
            >
              {saving ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <CheckIcon className="size-4" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
