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
import { resolveModel } from "@/lib/ai/models";
import { tool_thinking } from "@/lib/tools/tool_thinking";
import { tool_retrieve_okf_context } from "@/lib/tools/tool_retrieve_okf_context";
import { tool_snowflake_sql_query } from "@/lib/tools/tool_snowflake_sql_query";
import { tool_databricks_sql_query } from "@/lib/tools/tool_databricks_sql_query";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const maxSteps = 25;

function latestUserQuestion(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = message.parts
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  throw new Error("No user question was provided.");
}

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
  const model = openai.chat(selectedModel);
  const question = latestUserQuestion(messages);

  const basePrompt = fs
    .readFileSync(
      path.join(process.cwd(), "lib/prompts/assistant-prompt.md"),
      "utf-8",
    )
    .replace("{{CURRENT_DATE}}", new Date().toISOString().split("T")[0])
    .replace("{{USER_EMAIL}}", userEmail);

  const result = streamText({
    model,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(maxSteps),
    system: basePrompt,
    temperature: 0.0,
    tools: {
      tool_thinking: tool_thinking(),
      tool_retrieve_okf_context: tool_retrieve_okf_context({ question, model }),
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
    prepareStep: async ({ stepNumber }) => {
      if (stepNumber === 0) {
        return {
          toolChoice: { type: "tool", toolName: "tool_retrieve_okf_context" },
        };
      }
      return {};
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
