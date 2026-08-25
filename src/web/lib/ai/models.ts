export const CURRENT_MODEL = process.env.OPENAI_MODEL ?? "kit.qwen3.5-397b-A17b";
export const CURRENT_EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "kit.qwen3-embedding-8b";

export type ModelOption = {
  id: string;
  iconUrl?: string;
  invertIconInDarkMode?: boolean;
};

/** Models exposed by the Web app. The configured default is always available. */
export const AVAILABLE_MODELS = Array.from(
  new Set([
    CURRENT_MODEL,
    "kit.qwen3.5-397b-A17b",
    "kit.gpt-oss-120b",
    "kit.mistral-small-4-119b-a8b",
    "kit.gemma4-31b-it",
    "kit.minimax-m2.7-229b"
  ]),
);

export const AVAILABLE_MODEL_OPTIONS: ModelOption[] = AVAILABLE_MODELS.map(
  (id) => {
    const normalizedId = id.toLowerCase();

    if (normalizedId.includes("qwen")) {
      return {
        id,
        iconUrl:
          "https://upload.wikimedia.org/wikipedia/commons/6/69/Qwen_logo.svg",
      };
    }

    if (normalizedId.includes("gpt")) {
      return {
        id,
        iconUrl:
          "https://upload.wikimedia.org/wikipedia/commons/e/ef/ChatGPT-Logo.svg",
        invertIconInDarkMode: true,
      };
    }

    return { id };
  },
);

export function resolveModel(model?: string | null) {
  if (!model) return CURRENT_MODEL;
  return AVAILABLE_MODELS.includes(model) ? model : CURRENT_MODEL;
}
