import { createOpenAI } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  type JSONSchema7,
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import fs from "fs";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { resolveModel } from "@/lib/ai/model";
import { tool_thinking } from "@/lib/tools/tool_thinking";
import { tool_read_knowledge_store } from "@/lib/tools/tool_read_knowledge_store";
import { tool_snowflake_sql_query } from "@/lib/tools/tool_snowflake_sql_query";
import { tool_databricks_sql_query } from "@/lib/tools/tool_databricks_sql_query";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const maxSteps = 25;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userEmail = authData?.claims?.email ?? "";

  const {
    messages,
    tools,
    metadata,
  }: {
    messages: UIMessage[];
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
    metadata?: { custom?: { model?: string } };
  } = await req.json();

  const selectedModel = resolveModel(metadata?.custom?.model);

  const basePrompt = fs
    .readFileSync(
      path.join(process.cwd(), "lib/prompts/assistant-prompt.md"),
      "utf-8",
    )
    .replace("{{CURRENT_DATE}}", new Date().toISOString().split("T")[0])
    .replace("{{USER_EMAIL}}", userEmail);

  const result = streamText({
    model: openai.chat(selectedModel),
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(maxSteps),
    system: basePrompt,
    temperature: 0.0,
    tools: {
      tool_thinking: tool_thinking(),
      tool_read_knowledge_store: tool_read_knowledge_store(),
      tool_snowflake_sql_query: tool_snowflake_sql_query(),
      tool_databricks_sql_query: tool_databricks_sql_query(),
      ...frontendTools(tools ?? {}),
    },
    providerOptions: {
      openai: {
        reasoningEffort: "low",
        reasoningSummary: "auto",
      },
    },
    // Force tool calls for the first two steps
    prepareStep: async ({ stepNumber }) => {
      if (stepNumber === 0) {
        return {
          toolChoice: { type: "tool", toolName: "tool_read_knowledge_store" },
        };
      }
      // Later steps get default behavior
      return {};
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
