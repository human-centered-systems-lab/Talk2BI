import { requireGraphUser } from "@/lib/graph/auth";
import { createEmbeddings, getColumnEmbeddingText } from "@/lib/ai/embeddings";
import {
  ensureEmbeddingIndexes,
  ensureNodeTypes,
  getNeo4jDriver,
} from "@/lib/tools/tool_read_knowledge_store";
import type { Session } from "neo4j-driver";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown schema graph error";
}

function normalizeSynonyms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export async function GET(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const tableFullName = searchParams.get("tableFullName");

  if (!tableFullName) {
    return Response.json({ error: "Missing tableFullName." }, { status: 400 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    const result = await session.run(
      `
        MATCH (:Table { fullName: $tableFullName })-[:HAS_COLUMN]->(column:Column)
        RETURN
          column.fullName AS fullName,
          column.name AS name,
          column.sourceName AS sourceName,
          column.sqlIdentifier AS sqlIdentifier,
          column.sqlQualifiedName AS sqlQualifiedName,
          column.dataType AS dataType,
          column.ordinalPosition AS ordinalPosition,
          coalesce(column.description, "") AS description,
          coalesce(column.synonyms, []) AS synonyms
        ORDER BY column.ordinalPosition, column.name
      `,
      { tableFullName },
    );

    return Response.json({
      columns: result.records.map((record) => ({
        fullName: record.get("fullName") as string,
        name: record.get("name") as string,
        sourceName: record.get("sourceName") as string,
        sqlIdentifier: record.get("sqlIdentifier") as string | null,
        sqlQualifiedName: record.get("sqlQualifiedName") as string | null,
        dataType: record.get("dataType") as string,
        ordinalPosition:
          typeof record.get("ordinalPosition") === "number"
            ? (record.get("ordinalPosition") as number)
            : record.get("ordinalPosition").toNumber(),
        description: record.get("description") as string,
        synonyms: normalizeSynonyms(record.get("synonyms")),
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
    synonyms?: string[];
  };

  if (!body.fullName) {
    return Response.json({ error: "Missing column fullName." }, { status: 400 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  }

  let session: Session | null = null;

  try {
    const description = body.description ?? "";
    const synonyms = normalizeSynonyms(body.synonyms);
    session = driver.session();
    const columnResult = await session.run(
      `
        MATCH (column:Column { fullName: $fullName })
        OPTIONAL MATCH (dataset:Dataset)-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(:Table)-[:HAS_COLUMN]->(column)
        RETURN
          column.name AS name,
          coalesce(dataset.dialect, "Snowflake") AS dialect
      `,
      {
        fullName: body.fullName,
      },
    );
    const columnName = columnResult.records[0]?.get("name") as string | undefined;
    const dialect =
      (columnResult.records[0]?.get("dialect") as string | undefined) ??
      "Snowflake";

    if (!columnName) {
      return Response.json({ error: "Column not found." }, { status: 404 });
    }

    const embeddingText = getColumnEmbeddingText(
      columnName,
      description,
      synonyms,
    );
    const [embedding] = await createEmbeddings([embeddingText]);
    await ensureEmbeddingIndexes(session, embedding.length);
    await ensureNodeTypes(session);

    await session.run(
      `
        MATCH (column:Column { fullName: $fullName })
        SET
          column.type = $type,
          column.description = $description,
          column.synonyms = $synonyms,
          column.embeddingText = $embeddingText,
          column.embedding = $embedding
      `,
      {
        fullName: body.fullName,
        type: `${dialect} Column`,
        description,
        synonyms,
        embeddingText,
        embedding,
      },
    );

    return Response.json({
      success: true,
      embeddingText,
      embeddingDimensions: embedding.length,
      synonyms,
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
