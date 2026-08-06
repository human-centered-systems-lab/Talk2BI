type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
};

const EMBEDDING_BATCH_SIZE = 64;

function getEmbeddingsUrl() {
  const baseUrl = process.env.OPENAI_BASE_URL;

  if (!baseUrl) {
    throw new Error("OPENAI_BASE_URL is not configured.");
  }

  return `${baseUrl.replace(/\/$/, "")}/v1/embeddings`;
}

export function getTableEmbeddingText(name: string, description = "") {
  return `Table ${name} ${description}`.trim();
}

export function getColumnEmbeddingText(
  name: string,
  description = "",
  synonyms: string[] = [],
) {
  const synonymText =
    synonyms.length > 0 ? `Synonyms ${synonyms.join(", ")}` : "";

  return `Column ${name} ${description} ${synonymText}`.trim();
}

export function getKnowledgeEmbeddingText(
  title: string,
  content: string,
  filename = "",
) {
  return `Knowledge ${title} ${filename} ${content}`.trim();
}

export async function createEmbeddings(input: string[]) {
  const model = process.env.EMBEDDING_MODEL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!model) {
    throw new Error("EMBEDDING_MODEL is not configured.");
  }

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (input.length === 0) {
    return [];
  }

  const embeddings: number[][] = [];

  for (let index = 0; index < input.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = input.slice(index, index + EMBEDDING_BATCH_SIZE);
    embeddings.push(...(await createEmbeddingBatch(batch, model, apiKey)));
  }

  return embeddings;
}

async function createEmbeddingBatch(input: string[], model: string, apiKey: string) {
  const response = await fetch(getEmbeddingsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as EmbeddingResponse;

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Could not create embeddings.");
  }

  const embeddings = data.data?.map((item) => item.embedding) ?? [];

  if (embeddings.length !== input.length || embeddings.some((item) => !item)) {
    throw new Error("Embedding response did not match the requested inputs.");
  }

  return embeddings as number[][];
}
