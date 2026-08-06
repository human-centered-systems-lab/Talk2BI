import {
  listDatabricksColumns,
  listDatabricksDatabases,
  listDatabricksJoins,
  listDatabricksTables,
  quoteDatabricksIdentifier,
} from "@/lib/graph/databricks";
import {
  listSnowflakeColumns,
  listSnowflakeDatabases,
  listSnowflakeJoins,
  listSnowflakeTables,
  quoteSnowflakeIdentifier,
} from "@/lib/graph/snowflake";

export const DIALECTS = ["Snowflake", "Databricks"] as const;

export type Dialect = (typeof DIALECTS)[number];

/** A catalog/database, schema and table name, in every supported dialect. */
export type SourceTable = {
  database: string;
  schema: string;
  name: string;
};

export type SourceDatabase = {
  name: string;
};

export type SourceColumn = SourceTable & {
  column: string;
  dataType: string;
  ordinalPosition: number;
};

export type SourceJoin = {
  source: SourceTable;
  target: SourceTable;
  columns: Array<{
    source: string;
    target: string;
  }>;
};

export function isDialect(value: unknown): value is Dialect {
  return DIALECTS.some(
    (dialect) =>
      typeof value === "string" &&
      dialect.toLowerCase() === value.toLowerCase(),
  );
}

/** Maps any casing of a known dialect onto its canonical name. */
export function normalizeDialect(value: string | undefined | null): Dialect {
  const match = DIALECTS.find(
    (dialect) => dialect.toLowerCase() === value?.trim().toLowerCase(),
  );

  return match ?? "Snowflake";
}

export function quoteIdentifier(dialect: Dialect, identifier: string) {
  return dialect === "Databricks"
    ? quoteDatabricksIdentifier(identifier)
    : quoteSnowflakeIdentifier(identifier);
}

export function listSourceDatabases(
  dialect: Dialect,
): Promise<SourceDatabase[]> {
  return dialect === "Databricks"
    ? listDatabricksDatabases()
    : listSnowflakeDatabases();
}

export function listSourceTables(
  dialect: Dialect,
  database: string,
): Promise<SourceTable[]> {
  return dialect === "Databricks"
    ? listDatabricksTables(database)
    : listSnowflakeTables(database);
}

export function listSourceColumns(
  dialect: Dialect,
  tables: SourceTable[],
): Promise<SourceColumn[]> {
  return dialect === "Databricks"
    ? listDatabricksColumns(tables)
    : listSnowflakeColumns(tables);
}

export function listSourceJoins(
  dialect: Dialect,
  tables: SourceTable[],
): Promise<SourceJoin[]> {
  return dialect === "Databricks"
    ? listDatabricksJoins(tables)
    : listSnowflakeJoins(tables);
}
