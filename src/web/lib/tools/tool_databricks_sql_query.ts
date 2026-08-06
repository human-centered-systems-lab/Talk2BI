import { tool } from "ai";
import { z } from "zod";
import { DBSQLClient } from "@databricks/sql";
import type IDBSQLClient from "@databricks/sql/dist/contracts/IDBSQLClient";
import type IDBSQLSession from "@databricks/sql/dist/contracts/IDBSQLSession";

let client: IDBSQLClient | null = null;
let clientPromise: Promise<IDBSQLClient> | null = null;

function getHttpPath(warehouseId: string | undefined) {
  const httpPath = process.env.DATABRICKS_HTTP_PATH;
  if (httpPath) return httpPath;
  if (warehouseId) return `/sql/1.0/warehouses/${warehouseId}`;

  return null;
}

async function getDatabricksClient(): Promise<IDBSQLClient> {
  if (client) {
    return client;
  }

  if (clientPromise) {
    return clientPromise;
  }

  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  const path = getHttpPath(process.env.DATABRICKS_WAREHOUSE_ID);

  if (!host || !token || !path) {
    throw new Error(
      "Missing DATABRICKS_HOST, DATABRICKS_TOKEN, or DATABRICKS_WAREHOUSE_ID",
    );
  }

  clientPromise = new DBSQLClient()
    .connect({
      host: host.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
      path,
      token,
    })
    .then((connected) => {
      client = connected;
      return connected;
    })
    .catch((error) => {
      clientPromise = null;
      throw error;
    });

  return clientPromise;
}

export async function closeDatabricksClient(): Promise<void> {
  if (!client) {
    return;
  }

  await client.close();
  client = null;
  clientPromise = null;
}

export async function executeDatabricksQuery(
  sqlText: string,
): Promise<Record<string, unknown>[]> {
  const connection = await getDatabricksClient();
  const catalog = process.env.DATABRICKS_CATALOG;
  const schema = process.env.DATABRICKS_SCHEMA;

  let session: IDBSQLSession | null = null;

  try {
    session = await connection.openSession({
      initialCatalog: catalog || undefined,
      initialSchema: schema || undefined,
    });

    const operation = await session.executeStatement(sqlText);

    try {
      const rows = await operation.fetchAll();
      return rows as Record<string, unknown>[];
    } finally {
      await operation.close();
    }
  } finally {
    await session?.close();
  }
}

export const tool_databricks_sql_query = () =>
  tool({
    description:
      "Execute SQL against Databricks (Unity Catalog) and return structured results. Use fully qualified table names in the form catalog.schema.table. Prefer the sqlQualifiedName and sqlIdentifier fields returned by the context store for tables and columns, because Databricks identifiers are quoted with backticks. Do not invent or normalize column names.",

    inputSchema: z.object({
      sql_query_description: z
        .string()
        .describe(`Brief non-technical description of the query.`),
      query: z.string().describe(`The read-only SQL query.`),
    }),

    execute: async ({ query }) => {
      try {
        const rows = await executeDatabricksQuery(query);

        return {
          success: true,
          rowCount: rows.length,
          data: rows,
        };
      } catch (error) {
        console.error("[Databricks]", error);

        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown Databricks error",
        };
      }
    },
  });
