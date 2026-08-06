const STATEMENT_PATH = "/api/2.0/sql/statements";
const WAIT_TIMEOUT = "30s";
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type DatabricksConfig = {
  host: string;
  token: string;
  warehouseId: string;
  catalog: string;
  schema: string;
};

type StatementState =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "CLOSED";

type StatementResponse = {
  statement_id?: string;
  status?: {
    state?: StatementState;
    error?: { message?: string; error_code?: string };
  };
  manifest?: {
    schema?: {
      columns?: Array<{ name?: string; position?: number }>;
    };
  };
  result?: {
    data_array?: Array<Array<string | null>>;
    next_chunk_internal_link?: string;
  };
};

function normalizeHost(host: string) {
  const trimmed = host.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function isDatabricksConfigured() {
  return Boolean(
    process.env.DATABRICKS_HOST &&
      process.env.DATABRICKS_TOKEN &&
      process.env.DATABRICKS_WAREHOUSE_ID,
  );
}

export function getDatabricksConfig(): DatabricksConfig {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;

  if (!host || !token || !warehouseId) {
    throw new Error(
      "Missing DATABRICKS_HOST, DATABRICKS_TOKEN, or DATABRICKS_WAREHOUSE_ID",
    );
  }

  return {
    host: normalizeHost(host),
    token,
    warehouseId,
    catalog: process.env.DATABRICKS_CATALOG ?? "",
    schema: process.env.DATABRICKS_SCHEMA ?? "",
  };
}

async function request(
  config: DatabricksConfig,
  path: string,
  init?: RequestInit,
): Promise<StatementResponse> {
  const res = await fetch(`${config.host}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as StatementResponse & {
    message?: string;
  };

  if (!res.ok) {
    throw new Error(
      body?.message ??
        body?.status?.error?.message ??
        `Databricks request failed with status ${res.status}`,
    );
  }

  return body;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toRows(
  columns: Array<{ name?: string }>,
  dataArray: Array<Array<string | null>>,
): Record<string, unknown>[] {
  return dataArray.map((values) =>
    Object.fromEntries(
      columns.map((column, index) => [
        column.name ?? `col_${index}`,
        values[index] ?? null,
      ]),
    ),
  );
}

/**
 * Runs a statement through the Databricks SQL Statement Execution API and
 * returns every row as a plain object keyed by column name.
 */
export async function executeDatabricksQuery(
  statement: string,
  options: { catalog?: string; schema?: string } = {},
): Promise<Record<string, unknown>[]> {
  const config = getDatabricksConfig();
  const catalog = options.catalog ?? "";
  const schema = options.schema ?? "";

  let response = await request(config, STATEMENT_PATH, {
    method: "POST",
    body: JSON.stringify({
      statement,
      warehouse_id: config.warehouseId,
      wait_timeout: WAIT_TIMEOUT,
      on_wait_timeout: "CONTINUE",
      disposition: "INLINE",
      format: "JSON_ARRAY",
      ...(catalog ? { catalog } : {}),
      ...(schema ? { schema } : {}),
    }),
  });

  const statementId = response.statement_id;
  const startedAt = Date.now();

  while (
    response.status?.state === "PENDING" ||
    response.status?.state === "RUNNING"
  ) {
    if (!statementId) {
      throw new Error("Databricks did not return a statement id.");
    }

    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      await request(config, `${STATEMENT_PATH}/${statementId}/cancel`, {
        method: "POST",
      }).catch(() => undefined);
      throw new Error("Databricks statement timed out.");
    }

    await sleep(POLL_INTERVAL_MS);
    response = await request(config, `${STATEMENT_PATH}/${statementId}`);
  }

  const state = response.status?.state;

  if (state !== "SUCCEEDED") {
    throw new Error(
      response.status?.error?.message ??
        `Databricks statement ${state ?? "failed"}.`,
    );
  }

  const columns = response.manifest?.schema?.columns ?? [];
  const rows = toRows(columns, response.result?.data_array ?? []);
  let nextLink = response.result?.next_chunk_internal_link;

  while (nextLink) {
    const chunk = await request(config, nextLink);
    rows.push(...toRows(columns, chunk.result?.data_array ?? []));
    nextLink = chunk.result?.next_chunk_internal_link;
  }

  return rows;
}
