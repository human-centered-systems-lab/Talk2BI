import type { GraphTable, WarehouseTable } from "@/components/graph/types";

export function getTableKey(table: WarehouseTable) {
  return `${table.database}.${table.schema}.${table.name}`;
}

export function groupGraphTablesBySchema(tables: GraphTable[]) {
  const groups = new Map<string, GraphTable[]>();

  tables.forEach((table) => {
    const schemaTables = groups.get(table.schema) ?? [];
    schemaTables.push(table);
    groups.set(table.schema, schemaTables);
  });

  return Array.from(groups.entries()).sort(([schemaA], [schemaB]) =>
    schemaA.localeCompare(schemaB),
  );
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function parseSynonyms(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
