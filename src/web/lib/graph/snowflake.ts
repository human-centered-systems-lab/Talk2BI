import {
  executeSnowflakeQuery,
  getSnowflakeConnection,
} from "@/lib/tools/tool_snowflake_sql_query";
import { readNumber, readString } from "@/lib/graph/rows";
import {
  getTableFullName,
  type WarehouseColumn,
  type WarehouseDatabase,
  type WarehouseJoin,
  type WarehouseTable,
} from "@/lib/graph/types";

export function quoteSnowflakeIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function listSnowflakeDatabases(): Promise<WarehouseDatabase[]> {
  const conn = await getSnowflakeConnection();
  const rows = await executeSnowflakeQuery(conn, "SHOW DATABASES");

  return rows
    .map((row) => ({ name: readString(row, "name") }))
    .filter((database) => database.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSnowflakeTables(
  database: string,
): Promise<WarehouseTable[]> {
  const conn = await getSnowflakeConnection();
  const rows = await executeSnowflakeQuery(
    conn,
    `SHOW TABLES IN DATABASE ${quoteSnowflakeIdentifier(database)}`,
  );

  return rows
    .map((row) => ({
      database,
      schema: readString(row, "schema_name"),
      name: readString(row, "name"),
    }))
    .filter((table) => table.schema.length > 0 && table.name.length > 0)
    .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));
}

export async function listSnowflakeColumns(
  tables: WarehouseTable[],
): Promise<WarehouseColumn[]> {
  const conn = await getSnowflakeConnection();
  const columns: WarehouseColumn[] = [];

  for (const table of tables) {
    const database = quoteSnowflakeIdentifier(table.database);
    const schema = table.schema.replaceAll("'", "''");
    const name = table.name.replaceAll("'", "''");
    const rows = await executeSnowflakeQuery(
      conn,
      `
        SELECT
          TABLE_CATALOG,
          TABLE_SCHEMA,
          TABLE_NAME,
          COLUMN_NAME,
          DATA_TYPE,
          ORDINAL_POSITION
        FROM ${database}.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${schema}'
          AND TABLE_NAME = '${name}'
        ORDER BY ORDINAL_POSITION
      `,
    );

    columns.push(
      ...rows.map((row) => ({
        database: readString(row, "TABLE_CATALOG") || table.database,
        schema: readString(row, "TABLE_SCHEMA") || table.schema,
        name: readString(row, "TABLE_NAME") || table.name,
        column: readString(row, "COLUMN_NAME"),
        dataType: readString(row, "DATA_TYPE"),
        ordinalPosition: readNumber(row, "ORDINAL_POSITION"),
      })),
    );
  }

  return columns.filter((column) => column.column.length > 0);
}

export async function listSnowflakeJoins(
  tables: WarehouseTable[],
): Promise<WarehouseJoin[]> {
  const conn = await getSnowflakeConnection();
  const selectedTableKeys = new Set(tables.map(getTableFullName));
  const joins = new Map<string, WarehouseJoin>();
  const databases = Array.from(new Set(tables.map((table) => table.database)));

  for (const databaseName of databases) {
    const rows = await executeSnowflakeQuery(
      conn,
      `SHOW IMPORTED KEYS IN DATABASE ${quoteSnowflakeIdentifier(databaseName)}`,
    );

    rows.forEach((row) => {
      const source = {
        database: readString(row, "fk_database_name"),
        schema: readString(row, "fk_schema_name"),
        name: readString(row, "fk_table_name"),
      };
      const target = {
        database: readString(row, "pk_database_name"),
        schema: readString(row, "pk_schema_name"),
        name: readString(row, "pk_table_name"),
      };
      const sourceColumn = readString(row, "fk_column_name");
      const targetColumn = readString(row, "pk_column_name");
      const sourceKey = getTableFullName(source);
      const targetKey = getTableFullName(target);

      if (
        !selectedTableKeys.has(sourceKey) ||
        !selectedTableKeys.has(targetKey) ||
        !sourceColumn ||
        !targetColumn
      ) {
        return;
      }

      const joinKey = `${sourceKey}->${targetKey}`;
      const join: WarehouseJoin = joins.get(joinKey) ?? {
        source,
        target,
        columns: [],
      };

      join.columns.push({ source: sourceColumn, target: targetColumn });
      joins.set(joinKey, join);
    });
  }

  return Array.from(joins.values());
}
