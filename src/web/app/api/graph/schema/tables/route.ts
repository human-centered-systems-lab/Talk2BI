import { requireGraphUser } from "@/lib/graph/auth";
import { createEmbeddings, getTableEmbeddingText } from "@/lib/ai/embeddings";
import {
  ensureEmbeddingIndexes,
  ensureNodeTypes,
  getNeo4jDriver,
} from "@/lib/tools/tool_read_knowledge_store";
import type { Session } from "neo4j-driver";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown schema graph error";
}

export async function GET() {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    await ensureNodeTypes(session);
    const result = await session.run(`
      MATCH (dataset:Dataset)-[:HAS_SCHEMA]->(schema:Schema)-[:HAS_TABLE]->(table:Table)
      OPTIONAL MATCH (table)-[:HAS_COLUMN]->(column:Column)
      RETURN
        table.fullName AS fullName,
        table.sqlIdentifier AS sqlIdentifier,
        table.sqlQualifiedName AS sqlQualifiedName,
        coalesce(table.sourceName, table.name, table.fullName) AS name,
        schema.name AS schema,
        dataset.name AS database,
        coalesce(dataset.dialect, "Snowflake") AS dialect,
        coalesce(table.description, "") AS description,
        count(column) AS columnCount
      ORDER BY name
    `);

    return Response.json({
      tables: result.records.map((record) => ({
        fullName: record.get("fullName") as string,
        sqlIdentifier: record.get("sqlIdentifier") as string | null,
        sqlQualifiedName: record.get("sqlQualifiedName") as string | null,
        name: record.get("name") as string,
        schema: record.get("schema") as string,
        database: record.get("database") as string,
        dialect: record.get("dialect") as string,
        description: record.get("description") as string,
        columnCount:
          typeof record.get("columnCount") === "number"
            ? (record.get("columnCount") as number)
            : record.get("columnCount").toNumber(),
      })),
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}

export async function PATCH(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    fullName?: string;
    description?: string;
  };

  if (!body.fullName) {
    return Response.json({ error: "Missing table fullName." }, { status: 400 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  }

  let session: Session | null = null;

  try {
    const description = body.description ?? "";
    session = driver.session();
    const tableResult = await session.run(
      `
        MATCH (table:Table { fullName: $fullName })
        OPTIONAL MATCH (dataset:Dataset)-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(table)
        RETURN
          coalesce(table.sourceName, table.name, table.fullName) AS name,
          coalesce(dataset.dialect, "Snowflake") AS dialect
      `,
      {
        fullName: body.fullName,
      },
    );
    const tableName = tableResult.records[0]?.get("name") as string | undefined;
    const dialect =
      (tableResult.records[0]?.get("dialect") as string | undefined) ??
      "Snowflake";

    if (!tableName) {
      return Response.json({ error: "Table not found." }, { status: 404 });
    }

    const embeddingText = getTableEmbeddingText(tableName, description);
    const [embedding] = await createEmbeddings([embeddingText]);
    await ensureEmbeddingIndexes(session, embedding.length);
    await ensureNodeTypes(session);

    await session.run(
      `
        MATCH (table:Table { fullName: $fullName })
        SET
          table.type = $type,
          table.description = $description,
          table.embeddingText = $embeddingText,
          table.embedding = $embedding
      `,
      {
        fullName: body.fullName,
        type: `${dialect} Table`,
        description,
        embeddingText,
        embedding,
      },
    );

    return Response.json({
      success: true,
      embeddingText,
      embeddingDimensions: embedding.length,
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
