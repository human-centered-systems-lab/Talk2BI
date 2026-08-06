import { readNumber, readString } from "@/lib/graph/rows";
import {
  getTableFullName,
  type WarehouseColumn,
  type WarehouseDatabase,
  type WarehouseJoin,
  type WarehouseTable,
} from "@/lib/graph/types";
import { executeDatabricksQuery } from "@/lib/tools/tool_databricks_sql_query";

// A Databricks catalog plays the same role as a Snowflake database, so it is
// mapped onto the `database` field of the shared warehouse types.
export function quoteDatabricksIdentifier(identifier: string) {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

function quoteDatabricksLiteral(value: string) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function groupTablesByDatabase(tables: WarehouseTable[]) {
  const groups = new Map<string, WarehouseTable[]>();

  tables.forEach((table) => {
    const databaseTables = groups.get(table.database) ?? [];
    databaseTables.push(table);
    groups.set(table.database, databaseTables);
  });

  return groups;
}

export async function listDatabricksDatabases(): Promise<WarehouseDatabase[]> {
  const rows = await executeDatabricksQuery("SHOW CATALOGS");

  return rows
    .map((row) => ({
      name: readString(row, "catalog") || readString(row, "catalog_name"),
    }))
    .filter((database) => database.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listDatabricksTables(
  database: string,
): Promise<WarehouseTable[]> {
  const catalog = quoteDatabricksIdentifier(database);
  const rows = await executeDatabricksQuery(`
    SELECT table_schema, table_name
    FROM ${catalog}.information_schema.tables
    WHERE table_schema <> 'information_schema'
    ORDER BY table_schema, table_name
  `);

  return rows
    .map((row) => ({
      database,
      schema: readString(row, "table_schema"),
      name: readString(row, "table_name"),
    }))
    .filter((table) => table.schema.length > 0 && table.name.length > 0);
}

export async function listDatabricksColumns(
  tables: WarehouseTable[],
): Promise<WarehouseColumn[]> {
  const columns: WarehouseColumn[] = [];

  for (const [database, databaseTables] of groupTablesByDatabase(tables)) {
    const catalog = quoteDatabricksIdentifier(database);
    const tableFilter = databaseTables
      .map((table) => quoteDatabricksLiteral(`${table.schema}.${table.name}`))
      .join(", ");
    const rows = await executeDatabricksQuery(`
      SELECT
        table_catalog,
        table_schema,
        table_name,
        column_name,
        data_type,
        full_data_type,
        ordinal_position
      FROM ${catalog}.information_schema.columns
      WHERE concat(table_schema, '.', table_name) IN (${tableFilter})
      ORDER BY table_schema, table_name, ordinal_position
    `);

    columns.push(
      ...rows.map((row) => ({
        database: readString(row, "table_catalog") || database,
        schema: readString(row, "table_schema"),
        name: readString(row, "table_name"),
        column: readString(row, "column_name"),
        dataType:
          readString(row, "full_data_type") || readString(row, "data_type"),
        // Databricks counts columns from 0, Snowflake from 1.
        ordinalPosition: readNumber(row, "ordinal_position") + 1,
      })),
    );
  }

  return columns.filter((column) => column.column.length > 0);
}

export async function listDatabricksJoins(
  tables: WarehouseTable[],
): Promise<WarehouseJoin[]> {
  const selectedTableKeys = new Set(tables.map(getTableFullName));
  const joins = new Map<string, WarehouseJoin>();

  for (const database of groupTablesByDatabase(tables).keys()) {
    const catalog = quoteDatabricksIdentifier(database);
    let rows: Record<string, unknown>[] = [];

    try {
      // Unity Catalog exposes primary/foreign keys as informational
      // constraints. Catalogs without them simply return no rows.
      rows = await executeDatabricksQuery(`
        SELECT
          fk.table_catalog AS fk_catalog,
          fk.table_schema AS fk_schema,
          fk.table_name AS fk_table,
          fk.column_name AS fk_column,
          pk.table_catalog AS pk_catalog,
          pk.table_schema AS pk_schema,
          pk.table_name AS pk_table,
          pk.column_name AS pk_column
        FROM ${catalog}.information_schema.referential_constraints rc
        JOIN ${catalog}.information_schema.key_column_usage fk
          ON fk.constraint_catalog = rc.constraint_catalog
          AND fk.constraint_schema = rc.constraint_schema
          AND fk.constraint_name = rc.constraint_name
        JOIN ${catalog}.information_schema.key_column_usage pk
          ON pk.constraint_catalog = rc.unique_constraint_catalog
          AND pk.constraint_schema = rc.unique_constraint_schema
          AND pk.constraint_name = rc.unique_constraint_name
          AND pk.ordinal_position = fk.position_in_unique_constraint
        ORDER BY fk.table_schema, fk.table_name, fk.ordinal_position
      `);
    } catch (error) {
      console.error(`[Databricks] Could not read foreign keys for ${database}`, error);
      continue;
    }

    rows.forEach((row) => {
      const source = {
        database: readString(row, "fk_catalog"),
        schema: readString(row, "fk_schema"),
        name: readString(row, "fk_table"),
      };
      const target = {
        database: readString(row, "pk_catalog"),
        schema: readString(row, "pk_schema"),
        name: readString(row, "pk_table"),
      };
      const sourceColumn = readString(row, "fk_column");
      const targetColumn = readString(row, "pk_column");
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
      const join = joins.get(joinKey) ?? {
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
