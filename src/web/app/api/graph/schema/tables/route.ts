import type { Session } from "neo4j-driver";

import { requireGraphUser } from "@/lib/graph/auth";
import {
  getAppMetadata,
  listCatalogTables,
  rebuildTableBodies,
} from "@/lib/okf/catalog";
import {
  getNeo4jDriver,
  getNeo4jSession,
  replaceBundleConcepts,
} from "@/lib/okf/store";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown schema graph error";
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
    const tables = (await listCatalogTables(session))
      .map(({ concept, metadata }) => ({
        fullName: metadata.fullName,
        sqlIdentifier: metadata.sqlIdentifier,
        sqlQualifiedName: metadata.sqlQualifiedName,
        name: metadata.sourceName,
        schema: metadata.schema,
        database: metadata.database,
        dialect: metadata.dialect,
        description: concept.description,
        columnCount: metadata.columns.length,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return Response.json({ tables });
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
  if (!body.fullName) return Response.json({ error: "Missing table fullName." }, { status: 400 });
  const graphDriver = getNeo4jDriver();
  if (!graphDriver) return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  let session: Session | null = null;
  try {
    session = getNeo4jSession(graphDriver);
    const match = (await listCatalogTables(session)).find(
      ({ metadata }) => metadata.fullName === body.fullName,
    );
    if (!match) return Response.json({ error: "Table not found." }, { status: 404 });
    const description = body.description?.trim() ?? "";
    await replaceBundleConcepts(session, match.concept.bundle, (concepts) =>
      rebuildTableBodies(
        concepts.map((concept) => {
          const metadata = getAppMetadata(concept);
          return metadata?.kind === "table" && metadata.fullName === body.fullName
            ? { ...concept, description }
            : concept;
        }),
      ),
    );
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
