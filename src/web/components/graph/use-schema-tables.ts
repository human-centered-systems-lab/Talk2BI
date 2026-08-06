"use client";

import { useCallback, useMemo, useState } from "react";

import { fetchSchemaTables, getErrorMessage } from "@/components/graph/api";
import type { GraphTable } from "@/components/graph/types";

export type SchemaTablesStore = {
  tables: GraphTable[];
  /** Configured datasets, each with its tables, sorted by dataset name. */
  groups: Array<[string, GraphTable[]]>;
  loading: boolean;
  error: string;
  setError: (message: string) => void;
  setTables: React.Dispatch<React.SetStateAction<GraphTable[]>>;
  reload: () => Promise<void>;
};

/**
 * Tables currently stored in the graph. Shared by the tabs that render or
 * reference datasets, so a sync in one tab is visible in the others.
 */
export function useSchemaTables(): SchemaTablesStore {
  const [tables, setTables] = useState<GraphTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      setTables(await fetchSchemaTables());
    } catch (err) {
      setError(getErrorMessage(err, "Could not load graph tables."));
    } finally {
      setLoading(false);
    }
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, GraphTable[]>();

    tables.forEach((table) => {
      const databaseTables = grouped.get(table.database) ?? [];
      databaseTables.push(table);
      grouped.set(table.database, databaseTables);
    });

    return Array.from(grouped.entries()).sort(([databaseA], [databaseB]) =>
      databaseA.localeCompare(databaseB),
    );
  }, [tables]);

  return { tables, groups, loading, error, setError, setTables, reload };
}
