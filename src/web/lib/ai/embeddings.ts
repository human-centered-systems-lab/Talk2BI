import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";

import { CURRENT_EMBEDDING_MODEL } from "@/lib/ai/models";

const EMBEDDING_BATCH_SIZE = 64;

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export async function embedOkfTexts(values: string[]) {
  const embeddings: number[][] = [];
  const model = openai.embedding(CURRENT_EMBEDDING_MODEL);
  for (let offset = 0; offset < values.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = values.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const result = await embedMany({
      model,
      values: batch,
      maxParallelCalls: 1,
    });
    if (result.embeddings.length !== batch.length) {
      throw new Error("The embedding endpoint returned an unexpected vector count.");
    }
    embeddings.push(...result.embeddings);
  }
  return embeddings;
}
