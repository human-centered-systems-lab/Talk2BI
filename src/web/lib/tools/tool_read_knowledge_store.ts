import { tool } from "ai";
import { z } from "zod";
import neo4j, { type Driver, type Session, type Integer } from "neo4j-driver";
import { createEmbeddings } from "@/lib/ai/embeddings";

let driver: Driver | null = null;
const TOP_K = 20;

const EMBEDDING_INDEXES = {
  table: "table_embedding_index",
  column: "column_embedding_index",
  knowledge: "reference_chunk_embedding_index",
} as const;

type EmbeddingIndexName =
  (typeof EMBEDDING_INDEXES)[keyof typeof EMBEDDING_INDEXES];

type RetrievedHit = {
  id: string;
  labels: string[];
  score: number;
  matchTypes: string[];
  tableFullName: string;
  properties: Record<string, unknown>;
};

type ExpandedTable = {
  properties?: Record<string, unknown>;
  columns?: Array<Record<string, unknown>>;
};

type ExpandedJoinPath = {
  fromTable?: string;
  toTable?: string;
  relationships?: Array<{
    type?: string;
    properties?: Record<string, unknown>;
  }>;
};

export function getNeo4jDriver(): Driver | null {
  if (driver) return driver;

  const neo4jUri = process.env.NEO4J_URI;
  const neo4jUser = process.env.NEO4J_USER;
  const neo4jPassword = process.env.NEO4J_PASSWORD;

  if (!neo4jUri || !neo4jUser || !neo4jPassword) {
    return null;
  }

  try {
    driver = neo4j.driver(neo4jUri, neo4j.auth.basic(neo4jUser, neo4jPassword));
    return driver;
  } catch (error) {
    console.error("[Neo4j] Failed to create driver:", error);
    return null;
  }
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

function assertEmbeddingDimension(dimension: number) {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error("Embedding dimension must be a positive integer.");
  }
}

export async function ensureEmbeddingIndexes(
  session: Session,
  dimension: number,
  options: { recreate?: boolean } = {},
): Promise<void> {
  assertEmbeddingDimension(dimension);

  await session.run("DROP INDEX knowledge_chunk_embedding_index IF EXISTS");

  if (options.recreate) {
    await dropVectorIndex(session, EMBEDDING_INDEXES.table);
    await dropVectorIndex(session, EMBEDDING_INDEXES.column);
    await dropVectorIndex(session, EMBEDDING_INDEXES.knowledge);
  }

  await createVectorIndex(session, EMBEDDING_INDEXES.table, "Table", dimension);
  await createVectorIndex(session, EMBEDDING_INDEXES.column, "Column", dimension);
  await createVectorIndex(
    session,
    EMBEDDING_INDEXES.knowledge,
    "Chunk",
    dimension,
  );
  await awaitVectorIndex(session, EMBEDDING_INDEXES.table);
  await awaitVectorIndex(session, EMBEDDING_INDEXES.column);
  await awaitVectorIndex(session, EMBEDDING_INDEXES.knowledge);
}

export async function ensureNodeTypes(session: Session): Promise<void> {
  await session.run(`
    MATCH (table:Table)
    WHERE
      table.database IS NOT NULL AND trim(table.database) <> "" AND
      table.schema IS NOT NULL AND trim(table.schema) <> ""
    MERGE (dataset:Dataset { name: table.database })
    SET
      dataset.type = "Dataset",
      dataset.dialect = coalesce(dataset.dialect, "Snowflake")
    MERGE (schema:Schema { fullName: table.database + "." + table.schema })
    SET
      schema.type = "Schema",
      schema.name = table.schema
    MERGE (dataset)-[:HAS_SCHEMA]->(schema)
    MERGE (schema)-[:HAS_TABLE]->(table)
    REMOVE table.database, table.schema
  `);
  await session.run(`
    MATCH (:Dataset)-[relationship:HAS_TABLE]->(:Table)
    DELETE relationship
  `);
  await session.run(`
    MATCH (dataset:Dataset)
    SET
      dataset.type = "Dataset",
      dataset.dialect = coalesce(dataset.dialect, "Snowflake")
  `);
  await session.run(`
    MATCH (schema:Schema)
    SET schema.type = "Schema"
  `);
  await session.run(`
    MATCH (table:Table)
    WHERE table.type IS NULL
    SET table.type = "Snowflake Table"
  `);
  await session.run(`
    MATCH (column:Column)
    WHERE column.type IS NULL
    SET column.type = "Snowflake Column"
  `);
  await session.run(`
    MATCH (document:KnowledgeDocument)
    SET document:Reference
    REMOVE document:KnowledgeDocument
  `);
  await session.run(`
    MATCH (chunk:KnowledgeChunk)
    SET chunk:Chunk
    REMOVE chunk:KnowledgeChunk
  `);
  await session.run(`
    MATCH (reference:Reference)
    SET reference.type = "Reference"
  `);
  await session.run(`
    MATCH (chunk:Chunk)
    SET chunk.type = "Chunk"
  `);
}

async function dropVectorIndex(session: Session, indexName: EmbeddingIndexName) {
  await session.run(`DROP INDEX ${indexName} IF EXISTS`);
}

async function createVectorIndex(
  session: Session,
  indexName: EmbeddingIndexName,
  label: "Table" | "Column" | "Chunk",
  dimension: number,
) {
  await session.run(`
    CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
    FOR (node:${label}) ON (node.embedding)
    OPTIONS { indexConfig: {
      \`vector.dimensions\`: ${dimension},
      \`vector.similarity_function\`: 'cosine'
    }}
  `);
}

async function awaitVectorIndex(session: Session, indexName: EmbeddingIndexName) {
  await session.run("CALL db.awaitIndex($indexName)", { indexName });
}

// Recursively convert Neo4j Integer types to JS numbers, and
// Neo4j Node/Relationship objects to plain objects.
function serializeValue(value: unknown): unknown {
  if (neo4j.isInt(value)) {
    return (value as Integer).toNumber();
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const isNeo4jEntity =
      "properties" in obj &&
      ("identity" in obj || "elementId" in obj) &&
      ("labels" in obj || "type" in obj);
    const source = isNeo4jEntity
      ? (obj.properties as Record<string, unknown>)
      : obj;

    return Object.fromEntries(
      Object.entries(source).map(([k, v]) => [k, serializeValue(v)]),
    );
  }
  return value;
}

function serializeRecord(record: unknown) {
  return serializeValue(record) as Record<string, unknown>;
}

function toRetrievedHit(record: Record<string, unknown>): RetrievedHit {
  return {
    id: String(record.id ?? ""),
    labels: Array.isArray(record.labels) ? record.labels.map(String) : [],
    score: typeof record.score === "number" ? record.score : 0,
    matchTypes: Array.isArray(record.matchTypes)
      ? record.matchTypes.map(String)
      : [],
    tableFullName: String(record.tableFullName ?? ""),
    properties: serializeRecord(record.properties),
  };
}

function mergeHits(hits: RetrievedHit[]) {
  const merged = new Map<string, RetrievedHit>();

  hits.forEach((hit) => {
    const existing = merged.get(hit.id);

    if (!existing) {
      merged.set(hit.id, hit);
      return;
    }

    merged.set(hit.id, {
      ...existing,
      score: Math.max(existing.score, hit.score),
      matchTypes: Array.from(
        new Set([...existing.matchTypes, ...hit.matchTypes]),
      ),
      tableFullName: existing.tableFullName || hit.tableFullName,
    });
  });

  return Array.from(merged.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, TOP_K);
}

function extractMarkdownFilenames(query: string) {
  return Array.from(new Set(query.match(/[A-Za-z0-9_.-]+\.md/gi) ?? []));
}

function getStringProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
) {
  const value = properties?.[key];
  return typeof value === "string" ? value : "";
}

function getStringArrayProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
) {
  const value = properties?.[key];
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

function escapeYamlString(value: string) {
  return JSON.stringify(value);
}

function formatYamlArray(values: string[]) {
  if (values.length === 0) return "[]";

  return `[${values.map(escapeYamlString).join(", ")}]`;
}

function formatOkfResource(properties: Record<string, unknown> | undefined) {
  return (
    getStringProperty(properties, "sqlQualifiedName") ||
    getStringProperty(properties, "fullName") ||
    ""
  );
}

function formatFrontmatter(fields: Record<string, string | string[]>) {
  const lines = Object.entries(fields).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}: ${formatYamlArray(value)}`;
    }

    return `${key}: ${escapeYamlString(value)}`;
  });

  return `---\n${lines.join("\n")}\n---`;
}

function formatColumnRow(column: Record<string, unknown>) {
  const name =
    getStringProperty(column, "sqlIdentifier") ||
    getStringProperty(column, "sourceName") ||
    getStringProperty(column, "name") ||
    getStringProperty(column, "fullName");
  const type = getStringProperty(column, "dataType") || "UNKNOWN";
  const description = getStringProperty(column, "description");
  const synonyms = getStringArrayProperty(column, "synonyms");
  const details = [
    description || "No description available.",
    synonyms.length > 0 ? `Synonyms: ${synonyms.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `| \`${name.replaceAll("`", "\\`")}\` | ${type} | ${details.replaceAll("\n", " ")} |`;
}

function formatJoinLine(path: ExpandedJoinPath) {
  const joinRelationships = (path.relationships ?? []).filter(
    (relationship) => relationship.type === "JOINS_ON",
  );

  if (joinRelationships.length === 0) {
    return "";
  }

  const clauses = joinRelationships.flatMap((relationship) => {
    const condition = getStringProperty(relationship.properties, "condition");

    if (condition) {
      return [condition];
    }

    const sourceColumns = getStringArrayProperty(
      relationship.properties,
      "sourceColumns",
    );
    const targetColumns = getStringArrayProperty(
      relationship.properties,
      "targetColumns",
    );

    if (
      sourceColumns.length === 0 ||
      sourceColumns.length !== targetColumns.length
    ) {
      return [];
    }

    return sourceColumns.map(
      (source, index) => `${source} = ${targetColumns[index]}`,
    );
  });
  const fromTable = path.fromTable ?? "unknown table";
  const toTable = path.toTable ?? "unknown table";
  const condition = clauses.length > 0 ? ` on ${clauses.join(", ")}` : "";

  return `- Joined with ${toTable} from ${fromTable}${condition}.`;
}

function formatTableOkf(table: ExpandedTable, joinPaths: ExpandedJoinPath[]) {
  const properties = table.properties ?? (table as Record<string, unknown>);
  const type = getStringProperty(properties, "type") || "Table";
  const title =
    getStringProperty(properties, "sourceName") ||
    getStringProperty(properties, "name") ||
    getStringProperty(properties, "fullName") ||
    "Table";
  const description =
    getStringProperty(properties, "description") ||
    "No description available.";
  const fullName = getStringProperty(properties, "fullName");
  const database = getStringProperty(properties, "database");
  const schema = getStringProperty(properties, "schema");
  const tags = [database, schema].filter(Boolean);
  const relevantJoinLines = joinPaths
    .filter((path) => path.fromTable === fullName || path.toTable === fullName)
    .map(formatJoinLine)
    .filter(Boolean);
  const columns = Array.isArray(table.columns) ? table.columns : [];

  return [
    formatFrontmatter({
      type,
      title,
      description,
      resource: formatOkfResource(properties),
      tags,
      timestamp: new Date().toISOString(),
    }),
    "",
    "# Schema",
    "",
    "| Column | Type | Description |",
    "|--------|------|-------------|",
    ...columns.map(formatColumnRow),
    "",
    "# Joins",
    "",
    relevantJoinLines.length > 0
      ? Array.from(new Set(relevantJoinLines)).join("\n")
      : "No relevant joins retrieved.",
  ].join("\n");
}

function formatAvailableTablesOkf(tableCount: number) {
  return [
    formatFrontmatter({
      type: "Knowledge Retrieval Summary",
      title: "Available tables",
      description: "Number of tables currently available in the knowledge store.",
      resource: "",
      tags: ["tables"],
      timestamp: new Date().toISOString(),
    }),
    "",
    "# Available Tables",
    "",
    `${tableCount} ${tableCount === 1 ? "table" : "tables"} available.`,
  ].join("\n");
}

function formatKnowledgeOkf(hit: RetrievedHit) {
  const properties = hit.properties;
  const type = getStringProperty(properties, "type") || "Reference";
  const title =
    getStringProperty(properties, "title") ||
    getStringProperty(properties, "filename") ||
    "Reference";
  const filename = getStringProperty(properties, "filename");
  const datasets = getStringArrayProperty(properties, "datasets");
  const content =
    getStringProperty(properties, "content") || "No content available.";

  return [
    formatFrontmatter({
      type,
      title,
      description: `Retrieved reference from ${filename || "Context"}.`,
      resource: filename,
      tags: [...hit.matchTypes, ...datasets],
      timestamp: new Date().toISOString(),
    }),
    "",
    "# Content",
    "",
    content,
  ].join("\n");
}

function formatRetrievalOkf({
  availableTableCount,
  tables,
  joinPaths,
  knowledgeHits,
}: {
  availableTableCount: number;
  tables: unknown;
  joinPaths: unknown;
  knowledgeHits: RetrievedHit[];
}) {
  const expandedTables = Array.isArray(tables) ? (tables as ExpandedTable[]) : [];
  const expandedJoinPaths = Array.isArray(joinPaths)
    ? (joinPaths as ExpandedJoinPath[])
    : [];
  const availableTablesDocument = formatAvailableTablesOkf(availableTableCount);
  const documents = [
    ...(availableTablesDocument ? [availableTablesDocument] : []),
    ...expandedTables.map((table) => formatTableOkf(table, expandedJoinPaths)),
    ...knowledgeHits.map(formatKnowledgeOkf),
  ];

  if (documents.length === 0) {
    return [
      formatFrontmatter({
        type: "Knowledge Retrieval Result",
        title: "No relevant context",
        description: "No relevant tables, columns, joins, or knowledge chunks were retrieved.",
        resource: "",
        tags: [],
        timestamp: new Date().toISOString(),
      }),
      "",
      "# Result",
      "",
      "No relevant context was found in the knowledge store.",
    ].join("\n");
  }

  return documents.join("\n\n");
}

export const tool_read_knowledge_store = () =>
  tool({
    description:
      "Read from the semantic layer using natural language. Returns relevant tables, columns, joins, and references in Open Knowledge Format (OKF).",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Natural language keywords to search the semantic layer for relevant tables and columns.",
        ),
    }),
    execute: async ({ query }) => {
      const neo4jDriver = getNeo4jDriver();

      if (!neo4jDriver) {
        return {
          error:
            "Neo4j credentials not configured. Please set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD.",
        };
      }

      let session: Session | null = null;

      try {
        session = neo4jDriver.session();
        const [queryEmbedding] = await createEmbeddings([query]);
        await ensureEmbeddingIndexes(session, queryEmbedding.length);
        await ensureNodeTypes(session);
        const markdownFilenames = extractMarkdownFilenames(query);
        const availableTablesResult = await session.run(`
          MATCH (table:Table)
          RETURN count(table) AS tableCount
        `);
        const rawAvailableTableCount =
          availableTablesResult.records[0]?.get("tableCount");
        const availableTableCount =
          typeof rawAvailableTableCount === "number"
            ? rawAvailableTableCount
            : rawAvailableTableCount?.toNumber();

        const tableResult = await session.run(
          `
            CALL db.index.vector.queryNodes($tableIndex, $topK, $queryEmbedding)
            YIELD node, score
            OPTIONAL MATCH (dataset:Dataset)-[:HAS_SCHEMA]->(schema:Schema)-[:HAS_TABLE]->(node)
            RETURN
              elementId(node) AS id,
              labels(node) AS labels,
              score,
              ["table"] AS matchTypes,
              node.fullName AS tableFullName,
              node {
                .name,
                .sourceName,
                .fullName,
                .sqlIdentifier,
                .sqlQualifiedName,
                .type,
                .description,
                .embeddingText,
                database: dataset.name,
                schema: schema.name
              } AS properties
            ORDER BY score DESC
          `,
          {
            queryEmbedding,
            topK: neo4j.int(TOP_K),
            tableIndex: EMBEDDING_INDEXES.table,
          },
        );

        const columnResult = await session.run(
          `
            CALL db.index.vector.queryNodes($columnIndex, $topK, $queryEmbedding)
            YIELD node, score
            OPTIONAL MATCH (table:Table)-[:HAS_COLUMN]->(node)
            RETURN
              elementId(node) AS id,
              labels(node) AS labels,
              score,
              ["column"] AS matchTypes,
              table.fullName AS tableFullName,
              node {
                .name,
                .sourceName,
                .fullName,
                .sqlIdentifier,
                .sqlQualifiedName,
                .type,
                .description,
                .dataType,
                .ordinalPosition,
                .synonyms,
                .embeddingText
              } AS properties
            ORDER BY score DESC
          `,
          {
            queryEmbedding,
            topK: neo4j.int(TOP_K),
            columnIndex: EMBEDDING_INDEXES.column,
          },
        );

        const knowledgeResult = await session.run(
          `
            CALL db.index.vector.queryNodes($knowledgeIndex, $topK, $queryEmbedding)
            YIELD node, score
            OPTIONAL MATCH (reference:Reference)-[:HAS_CHUNK]->(node)
            OPTIONAL MATCH (dataset:Dataset)-[:HAS_REFERENCE]->(reference)
            WITH node, score, collect(DISTINCT dataset.name) AS datasetNames
            RETURN
              elementId(node) AS id,
              labels(node) AS labels,
              score,
              ["reference"] AS matchTypes,
              "" AS tableFullName,
              node {
                .id,
                .chunkIndex,
                .title,
                .filename,
                .type,
                .content,
                .embeddingText,
                datasets: [name IN datasetNames WHERE name IS NOT NULL]
              } AS properties
            ORDER BY score DESC
          `,
          {
            queryEmbedding,
            topK: neo4j.int(TOP_K),
            knowledgeIndex: EMBEDDING_INDEXES.knowledge,
          },
        );
        const directKnowledgeResult =
          markdownFilenames.length > 0
            ? await session.run(
                `
                  MATCH (reference:Reference)-[:HAS_CHUNK]->(node:Chunk)
                  OPTIONAL MATCH (dataset:Dataset)-[:HAS_REFERENCE]->(reference)
                  WHERE reference.filename IN $filenames
                  WITH node, collect(DISTINCT dataset.name) AS datasetNames
                  RETURN
                    elementId(node) AS id,
                    labels(node) AS labels,
                    1.0 AS score,
                    ["reference", "filename"] AS matchTypes,
                    "" AS tableFullName,
                    node {
                      .id,
                      .chunkIndex,
                      .title,
                      .filename,
                      .type,
                      .content,
                      .embeddingText,
                      datasets: [name IN datasetNames WHERE name IS NOT NULL]
                    } AS properties
                  ORDER BY node.chunkIndex
                `,
                { filenames: markdownFilenames },
              )
            : null;

        const tableHits = tableResult.records.map((record) =>
          toRetrievedHit(
            Object.fromEntries(
              record.keys.map((key) => [key, serializeValue(record.get(key))]),
            ),
          ),
        );
        const columnHits = columnResult.records.map((record) =>
          toRetrievedHit(
            Object.fromEntries(
              record.keys.map((key) => [key, serializeValue(record.get(key))]),
            ),
          ),
        );
        const knowledgeHits = knowledgeResult.records.map((record) =>
          toRetrievedHit(
            Object.fromEntries(
              record.keys.map((key) => [key, serializeValue(record.get(key))]),
            ),
          ),
        );
        const directKnowledgeHits =
          directKnowledgeResult?.records.map((record) =>
            toRetrievedHit(
              Object.fromEntries(
                record.keys.map((key) => [
                  key,
                  serializeValue(record.get(key)),
                ]),
              ),
            ),
          ) ?? [];
        const retrieved = mergeHits([
          ...tableHits,
          ...columnHits,
          ...knowledgeHits,
          ...directKnowledgeHits,
        ]);
        const tableFullNames = Array.from(
          new Set(
            retrieved
              .map((hit) => hit.tableFullName)
              .filter((fullName) => fullName.length > 0),
          ),
        );

        let tables: unknown = [];
        let joinPaths: unknown = [];

        if (tableFullNames.length > 0) {
          const tablesResult = await session.run(
            `
              MATCH (dataset:Dataset)-[:HAS_SCHEMA]->(schema:Schema)-[:HAS_TABLE]->(table:Table)
              WHERE table.fullName IN $tableFullNames
              OPTIONAL MATCH (table)-[:HAS_COLUMN]->(column:Column)
              WITH dataset, schema, table, column
              ORDER BY table.fullName, column.ordinalPosition, column.name
              WITH
                dataset,
                schema,
                table,
                collect(
                  CASE
                    WHEN column IS NULL THEN null
                    ELSE column {
                      .name,
                      .sourceName,
                      .fullName,
                      .sqlIdentifier,
                      .sqlQualifiedName,
                      .type,
                      .description,
                      .dataType,
                      .ordinalPosition,
                      .synonyms
                    }
                  END
                ) AS columns
              RETURN collect({
                id: elementId(table),
                labels: labels(table),
                properties: table {
                  .name,
                  .sourceName,
                  .fullName,
                  .sqlIdentifier,
                  .sqlQualifiedName,
                  .type,
                  .description,
                  database: dataset.name,
                  schema: schema.name
                },
                columns: [column IN columns WHERE column IS NOT NULL]
              }) AS tables
            `,
            { tableFullNames },
          );
          tables = serializeValue(tablesResult.records[0]?.get("tables") ?? []);
        }

        if (tableFullNames.length > 1) {
          const pathsResult = await session.run(
            `
              MATCH (leftTable:Table)
              WHERE leftTable.fullName IN $tableFullNames
              MATCH (rightTable:Table)
              WHERE rightTable.fullName IN $tableFullNames
                AND elementId(leftTable) < elementId(rightTable)
              MATCH path = allShortestPaths(
                (leftTable)-[:HAS_COLUMN|JOINS_ON*..6]-(rightTable)
              )
              WHERE any(relationship IN relationships(path) WHERE type(relationship) = "JOINS_ON")
              RETURN collect({
                fromTable: leftTable.fullName,
                toTable: rightTable.fullName,
                nodes: [
                  pathNode IN nodes(path) | {
                    id: elementId(pathNode),
                    labels: labels(pathNode),
                    properties: pathNode {
                      .name,
                      .sourceName,
                      .fullName,
                      .sqlIdentifier,
                      .sqlQualifiedName,
                      .type,
                      .description,
                      .dataType,
                      .ordinalPosition,
                      .synonyms
                    }
                  }
                ],
                relationships: [
                  relationship IN relationships(path) | {
                    type: type(relationship),
                    from: elementId(startNode(relationship)),
                    to: elementId(endNode(relationship)),
                    properties: relationship {
                      .condition,
                      .relationshipType,
                      .leftTable,
                      .rightTable,
                      .leftColumn,
                      .rightColumn,
                      .columnCount,
                      .sourceColumns,
                      .targetColumns
                    }
                  }
                ]
              }) AS joinPaths
            `,
            { tableFullNames },
          );
          joinPaths = serializeValue(
            pathsResult.records[0]?.get("joinPaths") ?? [],
          );
        }
        return formatRetrievalOkf({
          availableTableCount: availableTableCount ?? 0,
          tables,
          joinPaths,
          knowledgeHits: retrieved.filter((hit) =>
            hit.matchTypes.includes("reference"),
          ),
        });
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error occurred",
        };
      } finally {
        await session?.close();
      }
    },
  });
