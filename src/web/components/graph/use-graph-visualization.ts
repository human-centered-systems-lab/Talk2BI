"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchGraphVisualization,
  getErrorMessage,
} from "@/components/graph/api";
import type { GraphVisualization } from "@/components/graph/types";

export type GraphVisualizationStore = {
  graph: GraphVisualization | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  /** Drops the cached graph so the next visit refetches it. */
  invalidate: () => void;
};

/**
 * The rendered graph. Kept outside the visualization tab so it survives tab
 * switches, and is refetched only after another tab reports a change.
 */
export function useGraphVisualization(active: boolean): GraphVisualizationStore {
  const [graph, setGraph] = useState<GraphVisualization | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      setGraph(await fetchGraphVisualization());
    } catch (err) {
      setError(getErrorMessage(err, "Could not load graph visualization."));
    } finally {
      setLoading(false);
    }
  }, []);

  const invalidate = useCallback(() => setGraph(null), []);

  useEffect(() => {
    if (!active || graph) return;
    void reload();
  }, [active, graph, reload]);

  return { graph, loading, error, reload, invalidate };
}
