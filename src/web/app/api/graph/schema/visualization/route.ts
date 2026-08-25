import type { Session } from "neo4j-driver";

import { requireGraphUser } from "@/lib/graph/auth";
import { getNeo4jDriver, getNeo4jSession, toNumber } from "@/lib/okf/store";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown graph error";
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
    const result = await session.run(`
      MATCH (b:OKFNode:Bundle)
      OPTIONAL MATCH (c:OKFNode:Concept)-[:IN_BUNDLE]->(b)
      OPTIONAL MATCH (c)-[hs:HAS_SECTION]->(s:OKFNode:Section)
      RETURN b.uid AS bundleId, b.name AS bundleName, b.sync_state AS bundleState,
             c.uid AS conceptId, c.title AS conceptTitle, c.type AS conceptType,
             coalesce(c.stub, false) AS stub,
             s.uid AS sectionId, s.heading AS sectionHeading, hs.order AS sectionOrder
      ORDER BY bundleName, c.path, sectionOrder
    `);
    const nodes = new Map<string, { id: string; label: string; type: "bundle" | "concept" | "section" | "tag" | "application" | "suggestion"; detail: string }>();
    const edges = new Map<string, { id: string; source: string; target: string; label: string }>();
    for (const record of result.records) {
      const bundleId = record.get("bundleId") as string;
      nodes.set(bundleId, {
        id: bundleId,
        label: record.get("bundleName") as string,
        type: "bundle",
        detail: (record.get("bundleState") as string | null) ?? "unknown",
      });
      const conceptId = record.get("conceptId") as string | null;
      if (!conceptId) continue;
      nodes.set(conceptId, {
        id: conceptId,
        label: record.get("conceptTitle") as string,
        type: "concept",
        detail: `${record.get("conceptType") as string}${record.get("stub") ? " · stub" : ""}`,
      });
      edges.set(`${conceptId}->${bundleId}:IN_BUNDLE`, {
        id: `${conceptId}->${bundleId}:IN_BUNDLE`,
        source: conceptId,
        target: bundleId,
        label: "IN_BUNDLE",
      });
      const sectionId = record.get("sectionId") as string | null;
      if (!sectionId) continue;
      nodes.set(sectionId, {
        id: sectionId,
        label: record.get("sectionHeading") as string,
        type: "section",
        detail: `Section ${toNumber(record.get("sectionOrder")) + 1}`,
      });
      edges.set(`${conceptId}->${sectionId}:HAS_SECTION`, {
        id: `${conceptId}->${sectionId}:HAS_SECTION`,
        source: conceptId,
        target: sectionId,
        label: "HAS_SECTION",
      });
    }
    const relationships = await session.run(`
      MATCH (source:OKFNode)-[r:LINKS_TO|NEXT|TAGGED]->(target:OKFNode)
      RETURN source.uid AS source, target.uid AS target, type(r) AS type,
             coalesce(target.name, target.title, target.heading, target.uid) AS targetLabel
    `);
    for (const record of relationships.records) {
      const source = record.get("source") as string;
      const target = record.get("target") as string;
      const type = record.get("type") as string;
      if (type === "TAGGED" && !nodes.has(target)) {
        nodes.set(target, {
          id: target,
          label: record.get("targetLabel") as string,
          type: "tag",
          detail: "Tag",
        });
      }
      if (!nodes.has(source) || !nodes.has(target)) continue;
      const id = `${source}->${target}:${type}`;
      edges.set(id, { id, source, target, label: type });
    }
    const suggestions = await session.run(`
      MATCH (app:Application)-[:HAS_SUGGESTION]->(suggestion:Suggestion)
      RETURN app.key AS appKey, coalesce(app.name, app.key) AS appName,
             suggestion.id AS suggestionId, suggestion.label AS suggestionLabel,
             suggestion.category AS category
    `);
    for (const record of suggestions.records) {
      const appId = `application:${record.get("appKey") as string}`;
      const suggestionId = `suggestion:${record.get("suggestionId") as string}`;
      nodes.set(appId, { id: appId, label: record.get("appName") as string, type: "application", detail: "Application" });
      nodes.set(suggestionId, { id: suggestionId, label: record.get("suggestionLabel") as string, type: "suggestion", detail: record.get("category") as string });
      const id = `${appId}->${suggestionId}:HAS_SUGGESTION`;
      edges.set(id, { id, source: appId, target: suggestionId, label: "HAS_SUGGESTION" });
    }
    return Response.json({ nodes: [...nodes.values()], edges: [...edges.values()] });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
