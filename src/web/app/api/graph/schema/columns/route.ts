import type { Session } from "neo4j-driver";

import { requireGraphUser } from "@/lib/graph/auth";
import {
  getAppMetadata,
  listCatalogTables,
  rebuildTableBodies,
  type CatalogColumn,
  type TableMetadata,
} from "@/lib/okf/catalog";
import {
  getNeo4jDriver,
  getNeo4jSession,
  replaceBundleConcepts,
} from "@/lib/okf/store";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown schema graph error";
}

function normalizeSynonyms(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
}

export async function GET(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }
  const tableFullName = new URL(req.url).searchParams.get("tableFullName");
  if (!tableFullName) return Response.json({ error: "Missing tableFullName." }, { status: 400 });
  const graphDriver = getNeo4jDriver();
  if (!graphDriver) return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  let session: Session | null = null;
  try {
    session = getNeo4jSession(graphDriver);
    const table = (await listCatalogTables(session)).find(
      ({ metadata }) => metadata.fullName === tableFullName,
    );
    if (!table) return Response.json({ error: "Table not found." }, { status: 404 });
    return Response.json({ columns: table.metadata.columns });
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
    synonyms?: unknown;
  };
  if (!body.fullName) return Response.json({ error: "Missing column fullName." }, { status: 400 });
  const graphDriver = getNeo4jDriver();
  if (!graphDriver) return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  let session: Session | null = null;
  try {
    session = getNeo4jSession(graphDriver);
    const tables = await listCatalogTables(session);
    const owner = tables.find(({ metadata }) => metadata.columns.some((column) => column.fullName === body.fullName));
    if (!owner) return Response.json({ error: "Column not found." }, { status: 404 });
    const description = body.description?.trim() ?? "";
    const synonyms = normalizeSynonyms(body.synonyms);
    let updatedColumn: CatalogColumn | null = null;
    await replaceBundleConcepts(session, owner.concept.bundle, (concepts) =>
      rebuildTableBodies(
        concepts.map((concept) => {
          const metadata = getAppMetadata(concept);
          if (metadata?.kind !== "table" || metadata.fullName !== owner.metadata.fullName) return concept;
          const tableMetadata: TableMetadata = {
            ...metadata,
            columns: metadata.columns.map((column) => {
              if (column.fullName !== body.fullName) return column;
              updatedColumn = { ...column, description, synonyms };
              return updatedColumn;
            }),
          };
          return { ...concept, extraFrontmatter: { talk2bi: tableMetadata } };
        }),
      ),
    );
    if (!updatedColumn) return Response.json({ error: "Column not found." }, { status: 404 });
    return Response.json({
      success: true,
      synonyms,
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
