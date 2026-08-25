import type { Session } from "neo4j-driver";

import { requireGraphUser } from "@/lib/graph/auth";
import {
  getAppMetadata,
  joinInput,
  listCatalogJoins,
  listCatalogTables,
  rebuildTableBodies,
  type CatalogColumn,
  type JoinMetadata,
  type TableMetadata,
} from "@/lib/okf/catalog";
import {
  getNeo4jDriver,
  getNeo4jSession,
  replaceBundleConcepts,
  stableHash,
} from "@/lib/okf/store";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown schema graph error";
}

function required(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function columnKey(left: string, right: string) {
  return [left, right].sort().join("::");
}

function findColumn(table: TableMetadata, fullName: string) {
  return table.columns.find((column) => column.fullName === fullName) ?? null;
}

function graphJoin(
  metadata: JoinMetadata,
  tables: Map<string, TableMetadata>,
) {
  const left = tables.get(metadata.leftTableFullName);
  const right = tables.get(metadata.rightTableFullName);
  const exposeColumns = metadata.source === "manual" && metadata.leftColumns.length === 1;
  const leftColumn = exposeColumns
    ? left?.columns.find((column) => column.sourceName === metadata.leftColumns[0])
    : null;
  const rightColumn = exposeColumns
    ? right?.columns.find((column) => column.sourceName === metadata.rightColumns[0])
    : null;
  return {
    id: metadata.id,
    leftTableFullName: metadata.leftTableFullName,
    leftTableName: left?.sourceName ?? metadata.leftTableFullName,
    rightTableFullName: metadata.rightTableFullName,
    rightTableName: right?.sourceName ?? metadata.rightTableFullName,
    leftColumnFullName: leftColumn?.fullName ?? "",
    leftColumnName: leftColumn?.sourceName ?? "",
    rightColumnFullName: rightColumn?.fullName ?? "",
    rightColumnName: rightColumn?.sourceName ?? "",
    relationshipType: metadata.relationshipType,
    condition: metadata.condition,
    columnCount: metadata.leftColumns.length,
  };
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildSuggestions(
  tables: TableMetadata[],
  joins: JoinMetadata[],
) {
  const columns = tables.flatMap((table) =>
    table.columns.map((column) => ({ table, column })),
  );
  const existing = new Set<string>();
  for (const join of joins) {
    if (join.leftColumns.length !== 1 || join.rightColumns.length !== 1) continue;
    const left = tables.find((table) => table.fullName === join.leftTableFullName);
    const right = tables.find((table) => table.fullName === join.rightTableFullName);
    const leftColumn = left?.columns.find((column) => column.sourceName === join.leftColumns[0]);
    const rightColumn = right?.columns.find((column) => column.sourceName === join.rightColumns[0]);
    if (leftColumn && rightColumn) existing.add(columnKey(leftColumn.fullName, rightColumn.fullName));
  }
  const suggestions = [];
  for (let leftIndex = 0; leftIndex < columns.length; leftIndex += 1) {
    const left = columns[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < columns.length; rightIndex += 1) {
      const right = columns[rightIndex]!;
      if (left.table.fullName === right.table.fullName) continue;
      if (existing.has(columnKey(left.column.fullName, right.column.fullName))) continue;
      const leftName = normalizeName(left.column.sourceName);
      const rightName = normalizeName(right.column.sourceName);
      const sameName = leftName.length > 1 && leftName === rightName;
      if (!sameName) continue;
      const sameType = left.column.dataType.toLowerCase() === right.column.dataType.toLowerCase();
      const score = (leftName.endsWith("id") ? 95 : 80) + (sameType ? 5 : 0);
      suggestions.push({
        id: `${left.column.fullName}->${right.column.fullName}:SUGGESTED_JOIN`,
        leftTableFullName: left.table.fullName,
        leftTableName: left.table.sourceName,
        rightTableFullName: right.table.fullName,
        rightTableName: right.table.sourceName,
        leftColumnFullName: left.column.fullName,
        leftColumnName: left.column.sourceName,
        rightColumnFullName: right.column.fullName,
        rightColumnName: right.column.sourceName,
        relationshipType: "many-to-one",
        condition: `${left.column.fullName} = ${right.column.fullName}`,
        reason: `matching column name ${left.column.sourceName}`,
        score,
      });
    }
  }
  return suggestions.sort((left, right) => right.score - left.score).slice(0, 20);
}

async function context(session: Session) {
  const tableEntries = await listCatalogTables(session);
  const joinEntries = await listCatalogJoins(session);
  const tables = new Map(tableEntries.map(({ metadata }) => [metadata.fullName, metadata]));
  return { tableEntries, joinEntries, tables };
}

export async function GET() {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }
  const graphDriver = getNeo4jDriver();
  if (!graphDriver) return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  let session: Session | null = null;
  try {
    session = getNeo4jSession(graphDriver);
    const { tableEntries, joinEntries, tables } = await context(session);
    const joins = joinEntries
      .map(({ metadata }) => graphJoin(metadata, tables))
      .sort((left, right) => left.leftTableName.localeCompare(right.leftTableName));
    const suggestions = buildSuggestions(
      tableEntries.map(({ metadata }) => metadata),
      joinEntries.map(({ metadata }) => metadata),
    );
    return Response.json({ joins, suggestions });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}

type JoinPayload = {
  leftTableFullName?: unknown;
  rightTableFullName?: unknown;
  leftColumnFullName?: unknown;
  rightColumnFullName?: unknown;
  relationshipType?: unknown;
};

function readPayload(body: JoinPayload) {
  return {
    leftTableFullName: required(body.leftTableFullName),
    rightTableFullName: required(body.rightTableFullName),
    leftColumnFullName: required(body.leftColumnFullName),
    rightColumnFullName: required(body.rightColumnFullName),
    relationshipType: required(body.relationshipType),
  };
}

function validatePayload(payload: ReturnType<typeof readPayload>) {
  if (Object.values(payload).some((value) => !value)) return "Missing table, column, or relationship type.";
  if (payload.leftColumnFullName === payload.rightColumnFullName) return "Choose two different columns for the join.";
  return null;
}

function makeJoinMetadata(
  payload: ReturnType<typeof readPayload>,
  leftColumn: CatalogColumn,
  rightColumn: CatalogColumn,
): JoinMetadata {
  const identity = {
    leftTableFullName: payload.leftTableFullName,
    rightTableFullName: payload.rightTableFullName,
    leftColumnFullName: payload.leftColumnFullName,
    rightColumnFullName: payload.rightColumnFullName,
  };
  return {
    kind: "join",
    id: stableHash(identity, 24),
    leftTableFullName: payload.leftTableFullName,
    rightTableFullName: payload.rightTableFullName,
    leftColumns: [leftColumn.sourceName],
    rightColumns: [rightColumn.sourceName],
    relationshipType: payload.relationshipType,
    condition: `${leftColumn.fullName} = ${rightColumn.fullName}`,
    source: "manual",
  };
}

async function addJoin(session: Session, payload: ReturnType<typeof readPayload>) {
  const { tableEntries, joinEntries } = await context(session);
  const left = tableEntries.find(({ metadata }) => metadata.fullName === payload.leftTableFullName);
  const right = tableEntries.find(({ metadata }) => metadata.fullName === payload.rightTableFullName);
  const leftColumn = left && findColumn(left.metadata, payload.leftColumnFullName);
  const rightColumn = right && findColumn(right.metadata, payload.rightColumnFullName);
  if (!left || !right || !leftColumn || !rightColumn) throw new Error("Selected table or column was not found.");
  const metadata = makeJoinMetadata(payload, leftColumn, rightColumn);
  if (joinEntries.some(({ metadata: item }) => item.id === metadata.id)) throw new Error("This join already exists.");
  await replaceBundleConcepts(session, left.concept.bundle, (concepts) =>
    rebuildTableBodies([...concepts, joinInput(metadata)]),
  );
  return metadata;
}

export async function POST(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }
  const payload = readPayload((await req.json().catch(() => ({}))) as JoinPayload);
  const validation = validatePayload(payload);
  if (validation) return Response.json({ error: validation }, { status: 400 });
  const graphDriver = getNeo4jDriver();
  if (!graphDriver) return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  let session: Session | null = null;
  try {
    session = getNeo4jSession(graphDriver);
    const metadata = await addJoin(session, payload);
    return Response.json({
      success: true,
      join: {
        leftColumnFullName: payload.leftColumnFullName,
        rightColumnFullName: payload.rightColumnFullName,
        relationshipType: metadata.relationshipType,
        condition: metadata.condition,
      },
    });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json({ error: message }, { status: message.includes("not found") ? 404 : 500 });
  } finally {
    await session?.close();
  }
}

async function deleteMatchingJoin(
  session: Session,
  keys: {
    leftTableFullName: string;
    rightTableFullName: string;
    leftColumnFullName: string;
    rightColumnFullName: string;
  },
) {
  const { joinEntries, tables } = await context(session);
  const match = joinEntries.find(({ metadata }) => {
    if (
      metadata.leftTableFullName !== keys.leftTableFullName ||
      metadata.rightTableFullName !== keys.rightTableFullName
    ) return false;
    if (!keys.leftColumnFullName && !keys.rightColumnFullName) return true;
    const left = tables.get(metadata.leftTableFullName);
    const right = tables.get(metadata.rightTableFullName);
    const leftFull = left?.columns.find((column) => column.sourceName === metadata.leftColumns[0])?.fullName;
    const rightFull = right?.columns.find((column) => column.sourceName === metadata.rightColumns[0])?.fullName;
    return leftFull === keys.leftColumnFullName && rightFull === keys.rightColumnFullName;
  });
  if (!match) return 0;
  await replaceBundleConcepts(session, match.concept.bundle, (concepts) =>
    rebuildTableBodies(concepts.filter((concept) => concept.path !== match.concept.path)),
  );
  return 1;
}

export async function PATCH(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }
  const raw = (await req.json().catch(() => ({}))) as JoinPayload & Record<string, unknown>;
  const payload = readPayload(raw);
  const validation = validatePayload(payload);
  if (validation) return Response.json({ error: validation }, { status: 400 });
  const original = {
    leftTableFullName: required(raw.originalLeftTableFullName),
    rightTableFullName: required(raw.originalRightTableFullName),
    leftColumnFullName: required(raw.originalLeftColumnFullName),
    rightColumnFullName: required(raw.originalRightColumnFullName),
  };
  if (Object.values(original).some((value) => !value)) return Response.json({ error: "Missing original join identity." }, { status: 400 });
  const graphDriver = getNeo4jDriver();
  if (!graphDriver) return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  let session: Session | null = null;
  try {
    session = getNeo4jSession(graphDriver);
    const deleted = await deleteMatchingJoin(session, original);
    if (!deleted) return Response.json({ error: "Original join was not found." }, { status: 404 });
    const metadata = await addJoin(session, payload);
    return Response.json({
      success: true,
      join: {
        leftColumnFullName: payload.leftColumnFullName,
        rightColumnFullName: payload.rightColumnFullName,
        relationshipType: metadata.relationshipType,
        condition: metadata.condition,
      },
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}

export async function DELETE(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const keys = {
    leftTableFullName: required(raw.leftTableFullName),
    rightTableFullName: required(raw.rightTableFullName),
    leftColumnFullName: required(raw.leftColumnFullName),
    rightColumnFullName: required(raw.rightColumnFullName),
  };
  if (!keys.leftTableFullName || !keys.rightTableFullName) return Response.json({ error: "Missing join identity." }, { status: 400 });
  const graphDriver = getNeo4jDriver();
  if (!graphDriver) return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  let session: Session | null = null;
  try {
    session = getNeo4jSession(graphDriver);
    const deletedCount = await deleteMatchingJoin(session, keys);
    return Response.json({ success: true, deletedCount });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
