import { requireGraphUser } from "@/lib/graph/auth";
import {
  ensureNodeTypes,
  getNeo4jDriver,
} from "@/lib/tools/tool_read_knowledge_store";
import type { Session } from "neo4j-driver";

type GraphNode = {
  id: string;
  label: string;
  type:
    | "application"
    | "dataset"
    | "schema"
    | "table"
    | "column"
    | "reference"
    | "chunk"
    | "suggestion";
  detail: string;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown graph error";
}

export async function GET() {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json(
      { error: "Neo4j credentials not configured." },
      { status: 500 },
    );
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    await ensureNodeTypes(session);
    const schemaResult = await session.run(`
      MATCH (dataset:Dataset)-[:HAS_SCHEMA]->(schema:Schema)-[:HAS_TABLE]->(table:Table)
      OPTIONAL MATCH (table)-[:HAS_COLUMN]->(column:Column)
      RETURN
        table.fullName AS tableId,
        coalesce(table.sourceName, table.name, table.fullName) AS tableLabel,
        dataset.name AS tableDatabase,
        schema.name AS tableSchema,
        column.fullName AS columnId,
        coalesce(column.sourceName, column.name, column.fullName) AS columnLabel,
        coalesce(column.dataType, "") AS columnType
      ORDER BY tableLabel, columnLabel
    `);
    const joinResult = await session.run(`
      MATCH (source:Table)-[join:JOINS_ON]->(target:Table)
      RETURN
        source.fullName AS sourceId,
        target.fullName AS targetId,
        coalesce(join.columnCount, size(coalesce(join.sourceColumns, []))) AS columnCount,
        null AS relationshipType
      UNION
      MATCH (source:Column)-[join:JOINS_ON]->(target:Column)
      RETURN
        source.fullName AS sourceId,
        target.fullName AS targetId,
        1 AS columnCount,
        coalesce(join.relationshipType, "") AS relationshipType
      ORDER BY sourceId, targetId
    `);

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const hierarchyEdgeIds = new Set<string>();

    const datasetResult = await session.run(`
      MATCH (dataset:Dataset)-[:HAS_SCHEMA]->(schema:Schema)-[:HAS_TABLE]->(table:Table)
      RETURN
        dataset.name AS datasetName,
        coalesce(dataset.dialect, "Snowflake") AS dialect,
        schema.fullName AS schemaId,
        schema.name AS schemaName,
        table.fullName AS tableId
      ORDER BY datasetName, schemaName, tableId
    `);

    datasetResult.records.forEach((record) => {
      const datasetName = record.get("datasetName") as string;
      const datasetId = `dataset:${datasetName}`;
      const schemaId = record.get("schemaId") as string;
      const tableId = record.get("tableId") as string;

      nodes.set(datasetId, {
        id: datasetId,
        label: datasetName,
        type: "dataset",
        detail: record.get("dialect") as string,
      });
      nodes.set(schemaId, {
        id: schemaId,
        label: record.get("schemaName") as string,
        type: "schema",
        detail: datasetName,
      });

      const datasetSchemaEdgeId = `${datasetId}->${schemaId}:HAS_SCHEMA`;
      if (!hierarchyEdgeIds.has(datasetSchemaEdgeId)) {
        hierarchyEdgeIds.add(datasetSchemaEdgeId);
        edges.push({
          id: datasetSchemaEdgeId,
          source: datasetId,
          target: schemaId,
          label: "HAS_SCHEMA",
        });
      }

      const schemaTableEdgeId = `${schemaId}->${tableId}:HAS_TABLE`;
      if (!hierarchyEdgeIds.has(schemaTableEdgeId)) {
        hierarchyEdgeIds.add(schemaTableEdgeId);
        edges.push({
          id: schemaTableEdgeId,
          source: schemaId,
          target: tableId,
          label: "HAS_TABLE",
        });
      }
    });

    schemaResult.records.forEach((record) => {
      const tableId = record.get("tableId") as string;
      const tableSchema = record.get("tableSchema") as string;
      const tableDatabase = record.get("tableDatabase") as string;

      nodes.set(tableId, {
        id: tableId,
        label: record.get("tableLabel") as string,
        type: "table",
        detail: [tableDatabase, tableSchema].filter(Boolean).join("."),
      });

      const columnId = record.get("columnId") as string | null;
      if (!columnId) return;

      nodes.set(columnId, {
        id: columnId,
        label: record.get("columnLabel") as string,
        type: "column",
        detail: record.get("columnType") as string,
      });

      edges.push({
        id: `${tableId}->${columnId}`,
        source: tableId,
        target: columnId,
        label: "HAS_COLUMN",
      });
    });

    joinResult.records.forEach((record) => {
      const sourceId = record.get("sourceId") as string;
      const targetId = record.get("targetId") as string;
      const columnCountValue = record.get("columnCount");
      const columnCount =
        typeof columnCountValue === "number"
          ? columnCountValue
          : columnCountValue.toNumber();
      const relationshipType = record.get("relationshipType") as string | null;

      edges.push({
        id: `${sourceId}->${targetId}:JOINS_ON`,
        source: sourceId,
        target: targetId,
        label: relationshipType
          ? `JOINS_ON: ${relationshipType}`
          : columnCount > 1
            ? `JOINS_ON (${columnCount})`
            : "JOINS_ON",
      });
    });

    const knowledgeResult = await session.run(`
      MATCH (reference:Reference)
      OPTIONAL MATCH (dataset:Dataset)-[:HAS_REFERENCE]->(reference)
      OPTIONAL MATCH (reference)-[:HAS_CHUNK]->(chunk:Chunk)
      RETURN
        reference.filename AS documentId,
        coalesce(reference.title, reference.filename) AS documentLabel,
        coalesce(reference.filename, "") AS filename,
        dataset.name AS datasetName,
        chunk.id AS chunkId,
        coalesce(chunk.title, reference.title, reference.filename) AS chunkTitle,
        coalesce(chunk.chunkIndex, 0) AS chunkIndex
      ORDER BY documentLabel, chunkIndex
    `);

    knowledgeResult.records.forEach((record) => {
      const documentId = record.get("documentId") as string;
      const filename = record.get("filename") as string;
      const datasetName = record.get("datasetName") as string | null;

      nodes.set(documentId, {
        id: documentId,
        label: record.get("documentLabel") as string,
        type: "reference",
        detail: datasetName ? `${filename} · ${datasetName}` : `${filename} · Global`,
      });

      if (datasetName) {
        const datasetId = `dataset:${datasetName}`;
        const mappingEdgeId = `${datasetId}->${documentId}:HAS_REFERENCE`;
        if (!hierarchyEdgeIds.has(mappingEdgeId)) {
          hierarchyEdgeIds.add(mappingEdgeId);
          edges.push({
            id: mappingEdgeId,
            source: datasetId,
            target: documentId,
            label: "HAS_REFERENCE",
          });
        }
      }

      const chunkId = record.get("chunkId") as string | null;
      if (!chunkId) return;

      const chunkIndexValue = record.get("chunkIndex");
      const chunkIndex =
        typeof chunkIndexValue === "number"
          ? chunkIndexValue
          : chunkIndexValue.toNumber();

      nodes.set(chunkId, {
        id: chunkId,
        label: `${record.get("chunkTitle") as string} #${chunkIndex + 1}`,
        type: "chunk",
        detail: "Reference chunk",
      });

      const chunkEdgeId = `${documentId}->${chunkId}:HAS_CHUNK`;
      if (!hierarchyEdgeIds.has(chunkEdgeId)) {
        hierarchyEdgeIds.add(chunkEdgeId);
        edges.push({
          id: chunkEdgeId,
          source: documentId,
          target: chunkId,
          label: "HAS_CHUNK",
        });
      }
    });

    const suggestionResult = await session.run(`
      MATCH (app:Application)-[:HAS_SUGGESTION]->(suggestion:Suggestion)
      RETURN
        app.key AS appKey,
        coalesce(app.name, app.key) AS appName,
        suggestion.id AS suggestionId,
        suggestion.label AS suggestionLabel,
        suggestion.category AS suggestionCategory
      ORDER BY suggestion.sortOrder, suggestionLabel
    `);

    suggestionResult.records.forEach((record) => {
      const appId = `application:${record.get("appKey") as string}`;
      const suggestionId = `suggestion:${record.get("suggestionId") as string}`;

      nodes.set(appId, {
        id: appId,
        label: record.get("appName") as string,
        type: "application",
        detail: "Application",
      });
      nodes.set(suggestionId, {
        id: suggestionId,
        label: record.get("suggestionLabel") as string,
        type: "suggestion",
        detail: record.get("suggestionCategory") as string,
      });
      edges.push({
        id: `${appId}->${suggestionId}:HAS_SUGGESTION`,
        source: appId,
        target: suggestionId,
        label: "HAS_SUGGESTION",
      });
    });

    return Response.json({ nodes: Array.from(nodes.values()), edges });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
