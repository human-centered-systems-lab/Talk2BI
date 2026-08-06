import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import type { Session } from "neo4j-driver";
import { z } from "zod";

import { resolveModel } from "@/lib/ai/model";
import { requireGraphUser } from "@/lib/graph/auth";
import { getNeo4jDriver } from "@/lib/tools/tool_read_knowledge_store";

const APP_KEY = process.env.TALK2BI_APP_ID ?? "talk2bi";
const MAX_SCHEMA_CONTEXT_CHARS = 100_000;

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const generatedSuggestionsSchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        suggestions: z
          .array(
            z.object({
              label: z.string().min(1).max(60),
              prompt: z.string().min(1).max(500),
            }),
          )
          .min(1)
          .max(5),
      }),
    )
    .min(2)
    .max(6),
});

type SuggestionRecord = {
  id: string;
  category: string;
  label: string;
  prompt: string;
  sortOrder: number;
  model: string;
  updatedAt: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown suggestions error";
}

async function requireDriver() {
  await requireGraphUser();
  const driver = getNeo4jDriver();
  if (!driver) throw new Error("Neo4j credentials not configured.");
  return driver;
}

async function readSuggestions(session: Session): Promise<SuggestionRecord[]> {
  const result = await session.run(
    `
      MATCH (:Application {key: $appKey})-[:HAS_SUGGESTION]->(suggestion:Suggestion)
      RETURN
        suggestion.id AS id,
        suggestion.category AS category,
        suggestion.label AS label,
        suggestion.prompt AS prompt,
        suggestion.sortOrder AS sortOrder,
        coalesce(suggestion.model, "") AS model,
        coalesce(suggestion.updatedAt, "") AS updatedAt
      ORDER BY suggestion.sortOrder, suggestion.category, suggestion.label
    `,
    { appKey: APP_KEY },
  );

  return result.records.map((record) => ({
    id: record.get("id") as string,
    category: record.get("category") as string,
    label: record.get("label") as string,
    prompt: record.get("prompt") as string,
    sortOrder:
      typeof record.get("sortOrder") === "number"
        ? (record.get("sortOrder") as number)
        : record.get("sortOrder").toNumber(),
    model: record.get("model") as string,
    updatedAt: record.get("updatedAt") as string,
  }));
}

async function readSchemaContext(session: Session) {
  const result = await session.run(`
    MATCH (dataset:Dataset)-[:HAS_SCHEMA]->(schema:Schema)-[:HAS_TABLE]->(table:Table)
    OPTIONAL MATCH (table)-[:HAS_COLUMN]->(column:Column)
    WITH dataset, schema, table, column
    ORDER BY dataset.name, schema.name, table.name, column.ordinalPosition, column.name
    WITH dataset, schema, table, collect({
      name: coalesce(column.sourceName, column.name),
      type: coalesce(column.dataType, ""),
      description: coalesce(column.description, "")
    }) AS columns
    RETURN
      dataset.name AS dataset,
      coalesce(dataset.dialect, "Snowflake") AS dialect,
      schema.name AS schema,
      coalesce(table.sourceName, table.name, table.fullName) AS table,
      coalesce(table.description, "") AS description,
      columns
    ORDER BY dataset, schema, table
  `);

  const lines = result.records.map((record) => {
    const columns = (record.get("columns") as Array<Record<string, string>>)
      .filter((column) => column.name)
      .map((column) =>
        `${column.name}${column.type ? ` (${column.type})` : ""}${
          column.description ? ` — ${column.description}` : ""
        }`,
      )
      .join(", ");
    const description = record.get("description") as string;

    return [
      `${record.get("dataset")} [${record.get("dialect")}] > ${record.get("schema")} > ${record.get("table")}`,
      description ? `Table description: ${description}` : "",
      columns ? `Columns: ${columns}` : "Columns: none",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const context = lines.join("\n\n");
  if (!context) throw new Error("Add at least one dataset before generating suggestions.");
  if (context.length > MAX_SCHEMA_CONTEXT_CHARS) {
    throw new Error(
      "The available schema is too large to generate suggestions safely. Reduce the selected tables and try again.",
    );
  }

  return context;
}

export async function GET() {
  let session: Session | null = null;

  try {
    const driver = await requireDriver();
    session = driver.session();
    return Response.json({ suggestions: await readSuggestions(session) });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  } finally {
    await session?.close();
  }
}

export async function POST(req: Request) {
  let session: Session | null = null;

  try {
    const driver = await requireDriver();
    const body = (await req.json().catch(() => ({}))) as { model?: string };
    const model = resolveModel(body.model);
    session = driver.session();
    const schemaContext = await readSchemaContext(session);

    const result = await generateText({
      model: openai.chat(model),
      temperature: 0.2,
      output: Output.object({
        schema: generatedSuggestionsSchema,
        name: "business_intelligence_suggestions",
        description: "Categorized starter questions grounded in the available database schema.",
      }),
      system: `You create useful starter questions for a business intelligence chat application.
Use only the provided schema metadata. Do not assume unavailable metrics, entities, or business processes.
Create 3 to 5 distinct, concise categories with 2 to 4 suggestions each.
Category names and labels should be short. Prompts should be natural, specific questions a user can send directly.
Favor analytical variety: trends, comparisons, ranking, anomalies, composition, and operational questions when supported.
Do not mention schema inspection, SQL, table names, column names, or implementation details in the user-facing text.`,
      prompt: `Available Dataset, Schema, Table, and Column metadata:\n\n${schemaContext}`,
      providerOptions: {
        openai: {
          reasoningEffort: "low",
          reasoningSummary: "auto",
        },
      },
    });

    const now = new Date().toISOString();
    const suggestions = result.output.categories.flatMap((category, categoryIndex) =>
      category.suggestions.map((suggestion, suggestionIndex) => ({
        id: crypto.randomUUID(),
        category: category.name.trim(),
        label: suggestion.label.trim(),
        prompt: suggestion.prompt.trim(),
        sortOrder: categoryIndex * 100 + suggestionIndex,
        model,
        updatedAt: now,
      })),
    );

    await session.executeWrite(async (tx) => {
      await tx.run(
        `
          MERGE (app:Application {key: $appKey})
          SET app.name = "Talk2BI"
          WITH app
          OPTIONAL MATCH (app)-[:HAS_SUGGESTION]->(old:Suggestion)
          DETACH DELETE old
        `,
        { appKey: APP_KEY },
      );
      await tx.run(
        `
          MATCH (app:Application {key: $appKey})
          UNWIND $suggestions AS item
          CREATE (suggestion:Suggestion)
          SET suggestion = item
          CREATE (app)-[:HAS_SUGGESTION]->(suggestion)
        `,
        { appKey: APP_KEY, suggestions },
      );
    });

    return Response.json({ suggestions });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  } finally {
    await session?.close();
  }
}

export async function PATCH(req: Request) {
  let session: Session | null = null;

  try {
    const driver = await requireDriver();
    const body = (await req.json().catch(() => ({}))) as Partial<SuggestionRecord>;
    const id = body.id?.trim();
    const category = body.category?.trim();
    const label = body.label?.trim();
    const prompt = body.prompt?.trim();

    if (!id || !category || !label || !prompt) {
      return Response.json(
        { error: "Suggestion id, category, label, and prompt are required." },
        { status: 400 },
      );
    }

    session = driver.session();
    const result = await session.run(
      `
        MATCH (:Application {key: $appKey})-[:HAS_SUGGESTION]->(suggestion:Suggestion {id: $id})
        SET
          suggestion.category = $category,
          suggestion.label = $label,
          suggestion.prompt = $prompt,
          suggestion.updatedAt = $updatedAt
        RETURN suggestion.id AS id
      `,
      { appKey: APP_KEY, id, category, label, prompt, updatedAt: new Date().toISOString() },
    );

    if (result.records.length === 0) {
      return Response.json({ error: "Suggestion not found." }, { status: 404 });
    }

    return Response.json({ suggestions: await readSuggestions(session) });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  } finally {
    await session?.close();
  }
}

export async function DELETE(req: Request) {
  let session: Session | null = null;

  try {
    const driver = await requireDriver();
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    if (!body.id) {
      return Response.json({ error: "Suggestion id is required." }, { status: 400 });
    }

    session = driver.session();
    const result = await session.run(
      `
        MATCH (:Application {key: $appKey})-[:HAS_SUGGESTION]->(suggestion:Suggestion {id: $id})
        DETACH DELETE suggestion
        RETURN count(*) AS deletedCount
      `,
      { appKey: APP_KEY, id: body.id },
    );
    const deleted = result.records[0]?.get("deletedCount");
    const deletedCount = typeof deleted === "number" ? deleted : deleted?.toNumber() ?? 0;

    return Response.json({ success: true, deletedCount });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  } finally {
    await session?.close();
  }
}
