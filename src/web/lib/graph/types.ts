export const WAREHOUSE_DIALECTS = ["Snowflake", "Databricks"] as const;

export type WarehouseDialect = (typeof WAREHOUSE_DIALECTS)[number];

export type WarehouseDatabase = {
  name: string;
};

export type WarehouseTable = {
  database: string;
  schema: string;
  name: string;
  description?: string;
};

export type WarehouseColumn = WarehouseTable & {
  column: string;
  dataType: string;
  ordinalPosition: number;
};

export type WarehouseJoin = {
  source: WarehouseTable;
  target: WarehouseTable;
  columns: Array<{
    source: string;
    target: string;
  }>;
};

export function normalizeDialect(value: string | undefined | null) {
  const match = WAREHOUSE_DIALECTS.find(
    (dialect) => dialect.toLowerCase() === (value ?? "").trim().toLowerCase(),
  );

  return match ?? null;
}

/** The `fullName` a table is identified by across the graph. */
export function getTableFullName(table: WarehouseTable) {
  return `${table.database}.${table.schema}.${table.name}`;
}
