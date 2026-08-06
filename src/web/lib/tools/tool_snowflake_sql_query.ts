import { tool } from "ai";
import { z } from "zod";
import snowflake, { type Connection, type ConnectionOptions } from "snowflake-sdk";

let connection: Connection | null = null;
let connectionPromise: Promise<Connection> | null = null;

export async function getSnowflakeConnection(): Promise<Connection> {
  if (connection) {
    return connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  const token = process.env.SNOWFLAKE_PERSONALACCESSTOKEN;
  const warehouse = process.env.SNOWFLAKE_WAREHOUSE;
  const role = process.env.SNOWFLAKE_ROLE;

  if (!account || !username || !token) {
    throw new Error(
      "Missing SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, or SNOWFLAKE_PERSONALACCESSTOKEN"
    );
  }

  const options: ConnectionOptions = {
    account,
    username,

    // Personal Access Token authentication
    authenticator: "PROGRAMMATIC_ACCESS_TOKEN",
    token,

    warehouse,
    role,
  };

  connectionPromise = new Promise((resolve, reject) => {
    const conn = snowflake.createConnection(options);

    conn.connect((err) => {
      if (err) {
        connectionPromise = null;
        reject(err);
        return;
      }

      connection = conn;
      resolve(conn);
    });
  });

  return connectionPromise;
}

export async function closeConnection(): Promise<void> {
  if (!connection) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    connection!.destroy((err) => {
      if (err) {
        reject(err);
        return;
      }

      connection = null;
      connectionPromise = null;
      resolve();
    });
  });
}

export async function executeSnowflakeQuery(
  conn: Connection,
  sqlText: string
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,

      complete: (err, stmt, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve((rows ?? []) as Record<string, unknown>[]);
      },
    });
  });
}

export const tool_snowflake_sql_query = () =>
  tool({
    description:
      "Execute SQL against Snowflake database and return structured results. Use fully qualified table names. Prefer the sqlQualifiedName and sqlIdentifier fields returned by the context store for tables and columns, because Snowflake identifiers can be case-sensitive and may require double quotes. Do not invent or normalize column names.",

    inputSchema: z.object({
      sql_query_description: z
        .string()
        .describe(`Brief non-technical description of the query.`),
      query: z.string().describe(`The read-only SQL query.`),
    }),

    execute: async ({ query }) => {
      try {
        const conn = await getSnowflakeConnection();

        const rows = await executeSnowflakeQuery(conn, query);

        return {
          success: true,
          rowCount: rows.length,
          data: rows,
        };
      } catch (error) {
        console.error("[Snowflake]", error);

        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown Snowflake error",
        };
      }
    },
  });
