import { tool } from "ai";
import { z } from "zod";
import neo4j, { type Driver, type Session, type Integer } from "neo4j-driver";

let driver: Driver | null = null;

function getDriver(): Driver | null {
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
    // Neo4j Node / Relationship carry their properties in `.properties`
    const obj = value as Record<string, unknown>;
    const source = "properties" in obj ? (obj.properties as Record<string, unknown>) : obj;
    return Object.fromEntries(
      Object.entries(source).map(([k, v]) => [k, serializeValue(v)])
    );
  }
  return value;
}

export const tool_neo4j = () =>
  tool({
    description:
      "Query a Neo4j graph database using Cypher queries. Use this tool to retrieve structured data from the knowledge graph.",
    inputSchema: z.object({
      query: z.string().describe("Cypher query to execute"),
    }),
    execute: async ({ query }) => {
      const neo4jDriver = getDriver();

      if (!neo4jDriver) {
        return {
          error:
            "Neo4j credentials not configured. Please set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD.",
        };
      }

      let session: Session | null = null;

      try {
        session = neo4jDriver.session({
          defaultAccessMode: neo4j.session.READ,
        });

        const result = await session.run(query);

        const records = result.records.map((record) =>
          Object.fromEntries(
            record.keys.map((key) => [key, serializeValue(record.get(key))])
          )
        );

        const updates = result.summary.counters.updates();

        // Neo4j v6 returns regular numbers instead of Integer objects
        const toNum = (v: number | Integer): number => (neo4j.isInt(v) ? (v as Integer).toNumber() : v as number);

        return {
          success: true,
          recordKeys: result.records[0]?.keys ?? [],
          data: records,
          summary: {
            nodesCreated: toNum(updates.nodesCreated) > 0 ? toNum(updates.nodesCreated) : undefined,
            relationshipsCreated: toNum(updates.relationshipsCreated) > 0 ? toNum(updates.relationshipsCreated) : undefined,
            nodesDeleted: toNum(updates.nodesDeleted) > 0 ? toNum(updates.nodesDeleted) : undefined,
            relationshipsDeleted: toNum(updates.relationshipsDeleted) > 0 ? toNum(updates.relationshipsDeleted) : undefined,
          },
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error occurred",
        };
      } finally {
        await session?.close();
      }
    },
  });