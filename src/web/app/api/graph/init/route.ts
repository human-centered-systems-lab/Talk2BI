import type { Session } from "neo4j-driver";

import { requireGraphUser } from "@/lib/graph/auth";
import {
  getTableFullName,
  normalizeDialect,
  WAREHOUSE_DIALECTS,
  type WarehouseTable,
} from "@/lib/graph/types";
import { getWarehouseProvider } from "@/lib/graph/warehouse";
import { buildWarehouseBundle, warehouseBundleName } from "@/lib/okf/catalog";
import {
  deleteOkfBundle,
  ensureOkfSchema,
  getNeo4jDriver,
  getNeo4jSession,
  listOkfConcepts,
  syncOkfBundle,
} from "@/lib/okf/store";

type InitRequest = {
  tables?: WarehouseTable[];
  database?: string;
  dialect?: string;
  mode?: "replace" | "sync-database" | "remove-database";
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown graph init error";
}

function getValidTables(value: unknown): WarehouseTable[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is WarehouseTable => {
    if (!item || typeof item !== "object") return false;
    const table = item as Partial<WarehouseTable>;
    return Boolean(table.database?.trim() && table.schema?.trim() && table.name?.trim());
  });
}

async function removeManagedBundle(session: Session, database: string) {
  const result = await session.run(
    `MATCH (b:OKFNode:Bundle)
     WHERE b.source_database = $database AND b.managed_by = 'talk2bi'
     RETURN b.name AS name`,
    { database },
  );
  let deleted = 0;
  for (const record of result.records) {
    deleted += await deleteOkfBundle(session, record.get("name") as string);
  }
  return deleted;
}

async function removeLegacyProjection(session: Session) {
  await session.run(
    `MATCH (n)
     WHERE (n:Dataset OR n:Schema OR n:Table OR n:Column OR n:Reference OR n:Chunk)
       AND NOT n:OKFNode
     DETACH DELETE n`,
  );
}

async function removeLegacyDatabase(session: Session, database: string) {
  await session.run(
    `MATCH (:Dataset {name: $database})-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(:Table)-[:HAS_COLUMN]->(column:Column)
     DETACH DELETE column`,
    { database },
  );
  await session.run(
    `MATCH (:Dataset {name: $database})-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(table:Table)
     DETACH DELETE table`,
    { database },
  );
  await session.run(
    `MATCH (:Dataset {name: $database})-[:HAS_SCHEMA]->(schema:Schema)
     DETACH DELETE schema`,
    { database },
  );
  await session.run(
    "MATCH (dataset:Dataset {name: $database}) DETACH DELETE dataset",
    { database },
  );
}

export async function POST(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as InitRequest;
  const mode = body.mode ?? "replace";
  const database = body.database?.trim() ?? "";
  const dialect = normalizeDialect(body.dialect?.trim() || "Snowflake");
  const tables = getValidTables(body.tables);

  if ((mode === "sync-database" || mode === "remove-database") && !database) {
    return Response.json({ error: "Missing database." }, { status: 400 });
  }
  if (mode !== "remove-database" && !dialect) {
    return Response.json(
      { error: `Unsupported dialect. Supported dialects: ${WAREHOUSE_DIALECTS.join(", ")}.` },
      { status: 400 },
    );
  }
  if (mode !== "remove-database" && tables.length === 0) {
    return Response.json({ error: "Select at least one valid table." }, { status: 400 });
  }
  if (mode === "sync-database" && tables.some((table) => table.database !== database)) {
    return Response.json(
      { error: "Every selected table must belong to the chosen database." },
      { status: 400 },
    );
  }

  const graphDriver = getNeo4jDriver();
  if (!graphDriver) {
    return Response.json(
      { error: "Neo4j credentials not configured. Set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD." },
      { status: 500 },
    );
  }

  let session: Session | null = null;
  try {
    session = getNeo4jSession(graphDriver);
    await ensureOkfSchema(session);
    if (mode === "remove-database") {
      const deletedConcepts = await removeManagedBundle(session, database);
      await removeLegacyDatabase(session, database);
      return Response.json({ success: true, database, deletedConcepts });
    }

    if (mode === "replace") {
      const managed = await session.run(
        "MATCH (b:OKFNode:Bundle {managed_by: 'talk2bi'}) RETURN b.name AS name",
      );
      for (const record of managed.records) {
        await deleteOkfBundle(session, record.get("name") as string);
      }
      await removeLegacyProjection(session);
    }

    const provider = getWarehouseProvider(dialect!);
    const sourceTables = (
      await Promise.all(
        [...new Set(tables.map((table) => table.database))].map((name) =>
          provider.listTables(name),
        ),
      )
    ).flat();
    const sourceByFullName = new Map(
      sourceTables.map((table) => [getTableFullName(table), table]),
    );
    const hydratedTables = tables.map((table) => ({
      ...table,
      description:
        sourceByFullName.get(getTableFullName(table))?.description ??
        table.description ??
        "",
    }));
    const columns = await provider.listColumns(hydratedTables);
    const joins = await provider.listJoins(hydratedTables);
    const bundleName = warehouseBundleName(
      provider.dialect,
      database || hydratedTables[0]!.database,
    );
    const existing = await listOkfConcepts(session, { bundle: bundleName });
    const bundle = buildWarehouseBundle({
      database: database || hydratedTables[0]!.database,
      dialect: provider.dialect,
      tables: hydratedTables,
      columns,
      joins,
      quoteIdentifier: provider.quoteIdentifier,
      existing,
    });
    const stored = await syncOkfBundle(session, bundle);
    if (mode === "sync-database") await removeLegacyDatabase(session, database);

    return Response.json({
      success: true,
      bundle: stored.bundle,
      tablesCreated: hydratedTables.length,
      columnsCreated: columns.length,
      joinsCreated: joins.length,
      conceptsCreated: stored.concepts,
      sectionsCreated: stored.sections,
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
