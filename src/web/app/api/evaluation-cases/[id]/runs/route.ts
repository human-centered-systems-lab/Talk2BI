import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import fs from "fs";
import path from "path";

import {
  createEvaluationRun,
  getEvaluationCase,
} from "@/lib/db";
import { CURRENT_MODEL } from "@/lib/ai/model";
import { createClient } from "@/lib/supabase/server";
import { tool_snowflake_sql_query } from "@/lib/tools/tool_snowflake_sql_query";
import { tool_databricks_sql_query } from "@/lib/tools/tool_databricks_sql_query";
import { tool_read_knowledge_store } from "@/lib/tools/tool_read_knowledge_store";
import { tool_thinking } from "@/lib/tools/tool_thinking";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const maxSteps = 25;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ToolTraceItem = {
  stepIndex: number;
  calls: unknown[];
  results: unknown[];
};

async function getUserId(): Promise<string> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user.id;
}

export async function POST(
  _req: Request,
  context: RouteContext,
) {
  let userId = "";
  let caseId = "";

  try {
    userId = await getUserId();
    const params = await context.params;
    caseId = params.id;

    const evaluationCase = await getEvaluationCase(userId, caseId);

    if (!evaluationCase) {
      return Response.json(
        { error: "Evaluation case not found" },
        { status: 404 },
      );
    }

    const basePrompt = fs
      .readFileSync(
        path.join(process.cwd(), "lib/prompts/assistant-prompt.md"),
        "utf-8",
      )
      .replace("{{CURRENT_DATE}}", new Date().toISOString().split("T")[0])
      .replace("{{USER_EMAIL}}", "");

    const system = `${basePrompt}

## Evaluation mode

Answer the evaluation question as you would answer a user in chat.
Query the warehouse the retrieved tables belong to: use tool_snowflake_sql_query for Snowflake tables and tool_databricks_sql_query for Databricks tables.
Your final response must include the final answer, a "Result" heading with the final query result as a Markdown table, and exactly one final SQL statement under a "Final SQL" heading.
The final SQL must be the SQL statement that directly supports the answer.`;

    const result = await generateText({
      model: openai.chat(CURRENT_MODEL),
      system,
      messages: [
        {
          role: "user",
          content: evaluationCase.question,
        },
      ],
      stopWhen: stepCountIs(maxSteps),
      temperature: 0,
      tools: {
        tool_thinking: tool_thinking(),
        tool_read_knowledge_store: tool_read_knowledge_store(),
        tool_snowflake_sql_query: tool_snowflake_sql_query(),
        tool_databricks_sql_query: tool_databricks_sql_query(),
      },
      providerOptions: {
        openai: {
          reasoningEffort: "low",
          reasoningSummary: "auto",
        },
      },
    });

    const trace = extractToolTrace(result);
    const resultText = extractResultText(result.text);
    const finalSql = extractFinalSql(result.text);
    const executedSql = extractExecutedSql(trace);

    const run = await createEvaluationRun(userId, {
      caseId: evaluationCase.id,
      question: evaluationCase.question,
      goldSql: evaluationCase.goldSql,
      answerText: result.text,
      finalSql,
      executedSql,
      status: "success",
      error: null,
      toolTrace: trace,
    });

    return Response.json({ ...run, resultText }, { status: 201 });
  } catch (error) {
    const message = getErrorMessage(error);

    if (userId && caseId) {
      let evaluationCase;

      try {
        evaluationCase = await getEvaluationCase(userId, caseId);
      } catch (caseError) {
        return Response.json(
          {
            error: `${message}; additionally failed to reload evaluation case: ${getErrorMessage(caseError)}`,
          },
          { status: 500 },
        );
      }

      if (evaluationCase) {
        try {
          const run = await createEvaluationRun(userId, {
            caseId: evaluationCase.id,
            question: evaluationCase.question,
            goldSql: evaluationCase.goldSql,
            answerText: null,
            finalSql: null,
            executedSql: null,
            status: "error",
            error: message,
            toolTrace: [],
          });

          return Response.json(run, { status: 201 });
        } catch (persistError) {
          return Response.json(
            {
              error: `${message}; additionally failed to store evaluation error run: ${getErrorMessage(persistError)}`,
            },
            { status: 500 },
          );
        }
      }
    }

    const status = message === "Unauthorized" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

function extractFinalSql(text: string): string | null {
  const finalSqlMatch = text.match(
    /(?:^|\n)#{1,6}\s*Final SQL\s*\n+```sql\s*([\s\S]*?)```/i,
  );

  if (finalSqlMatch?.[1]?.trim()) {
    return finalSqlMatch[1].trim();
  }

  const sqlBlockMatch = text.match(/```sql\s*([\s\S]*?)```/i);
  if (sqlBlockMatch?.[1]?.trim()) {
    return sqlBlockMatch[1].trim();
  }

  const plainFinalSqlMatch = text.match(
    /(?:^|\n)#{0,6}\s*Final SQL\s*:?\s*\n+([\s\S]*?)(?:\n{2,}|$)/i,
  );

  return plainFinalSqlMatch?.[1]?.trim() ?? null;
}

function extractResultText(text: string): string | null {
  const resultMatch = text.match(
    /(?:^|\n)#{1,6}\s*Result\s*\n+([\s\S]*?)(?=\n#{1,6}\s*Final SQL\s*\n|$)/i,
  );

  return resultMatch?.[1]?.trim() ?? null;
}

function extractToolTrace(result: unknown): ToolTraceItem[] {
  const record = getRecord(result);
  const steps = record.steps;
  const trace: ToolTraceItem[] = [];

  const topLevelCalls = Array.isArray(record.toolCalls)
    ? record.toolCalls
    : [];
  const topLevelResults = Array.isArray(record.toolResults)
    ? record.toolResults
    : [];

  if (topLevelCalls.length > 0 || topLevelResults.length > 0) {
    trace.push({
      stepIndex: -1,
      calls: topLevelCalls,
      results: topLevelResults,
    });
  }

  if (!Array.isArray(steps)) {
    return trace;
  }

  return [
    ...trace,
    ...steps.map((step, stepIndex) => {
    const record = getRecord(step);

    return {
      stepIndex,
      calls: Array.isArray(record.toolCalls) ? record.toolCalls : [],
      results: Array.isArray(record.toolResults) ? record.toolResults : [],
    };
    }),
  ];
}

function extractExecutedSql(trace: ToolTraceItem[]): string | null {
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const item = trace[index];

    for (let resultIndex = item.results.length - 1; resultIndex >= 0; resultIndex -= 1) {
      const result = getRecord(item.results[resultIndex]);
      const output = getRecord(result.output ?? result.result);
      const input = getRecord(result.input ?? result.args);
      const query = output.query ?? input.query;

      if (typeof query === "string" && query.trim()) {
        return query.trim();
      }
    }

    for (let callIndex = item.calls.length - 1; callIndex >= 0; callIndex -= 1) {
      const call = getRecord(item.calls[callIndex]);
      const input = getRecord(call.input ?? call.args);
      const query = input.query;

      if (typeof query === "string" && query.trim()) {
        return query.trim();
      }
    }
  }

  return null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
