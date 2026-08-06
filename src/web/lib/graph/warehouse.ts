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
import {
  normalizeDialect,
  WAREHOUSE_DIALECTS,
  type WarehouseColumn,
  type WarehouseDatabase,
  type WarehouseDialect,
  type WarehouseJoin,
  type WarehouseTable,
} from "@/lib/graph/types";

export type WarehouseProvider = {
  dialect: WarehouseDialect;
  quoteIdentifier: (identifier: string) => string;
  listDatabases: () => Promise<WarehouseDatabase[]>;
  listTables: (database: string) => Promise<WarehouseTable[]>;
  listColumns: (tables: WarehouseTable[]) => Promise<WarehouseColumn[]>;
  listJoins: (tables: WarehouseTable[]) => Promise<WarehouseJoin[]>;
};

const providers: Record<WarehouseDialect, WarehouseProvider> = {
  Snowflake: {
    dialect: "Snowflake",
    quoteIdentifier: quoteSnowflakeIdentifier,
    listDatabases: listSnowflakeDatabases,
    listTables: listSnowflakeTables,
    listColumns: listSnowflakeColumns,
    listJoins: listSnowflakeJoins,
  },
  Databricks: {
    dialect: "Databricks",
    quoteIdentifier: quoteDatabricksIdentifier,
    listDatabases: listDatabricksDatabases,
    listTables: listDatabricksTables,
    listColumns: listDatabricksColumns,
    listJoins: listDatabricksJoins,
  },
};

export function getWarehouseProvider(
  dialect: string | undefined | null,
): WarehouseProvider {
  const normalized = normalizeDialect(dialect);

  if (!normalized) {
    throw new Error(
      `Unsupported dialect "${dialect ?? ""}". Supported dialects: ${WAREHOUSE_DIALECTS.join(", ")}.`,
    );
  }

  return providers[normalized];
}
