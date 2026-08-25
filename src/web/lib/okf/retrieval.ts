import type { OkfFileCard } from "@/lib/okf/store";

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const RETRIEVAL_TOP_K = 3;

const TOKEN_RE = /[A-Za-z0-9]+/g;

function compareFileIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type RankedFile = {
  fileId: string;
  score: number;
};

export type VectorSection = {
  fileId: string;
  embedding: number[];
};

export function tokenizeRetrievalText(value: string) {
  return Array.from(value.matchAll(TOKEN_RE), (match) => match[0]!.toLowerCase());
}

export function okfCardSearchText(card: OkfFileCard) {
  return [
    card.file_id,
    card.title,
    card.description,
    ...card.tags,
    ...card.headings,
    ...card.columns,
  ].join(" ");
}

export function rankOkfCardsBm25(
  question: string,
  cards: OkfFileCard[],
  limit = RETRIEVAL_TOP_K,
): RankedFile[] {
  if (!cards.length || limit <= 0) return [];
  const documents = cards.map((card) => tokenizeRetrievalText(okfCardSearchText(card)));
  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) /
      documents.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of new Set(document)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const queryTerms = [...new Set(tokenizeRetrievalText(question))];
  const ranked = cards.map((card, index): RankedFile => {
    const document = documents[index]!;
    const termFrequency = new Map<string, number>();
    for (const token of document) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }
    const lengthNormalization =
      1 - BM25_B + (BM25_B * document.length) / averageLength;
    let score = 0;
    for (const term of queryTerms) {
      const frequency = termFrequency.get(term) ?? 0;
      if (!frequency) continue;
      const frequencyAcrossDocuments = documentFrequency.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 +
          (documents.length - frequencyAcrossDocuments + 0.5) /
            (frequencyAcrossDocuments + 0.5),
      );
      score +=
        inverseDocumentFrequency *
        ((frequency * (BM25_K1 + 1)) /
          (frequency + BM25_K1 * lengthNormalization));
    }
    return { fileId: card.file_id, score };
  });
  return ranked
    .sort((left, right) => right.score - left.score || compareFileIds(left.fileId, right.fileId))
    .slice(0, limit);
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) {
    throw new Error("Embedding vectors must have the same non-zero dimensions.");
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new Error("Embedding vectors must contain only finite values.");
    }
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (!leftMagnitude || !rightMagnitude) {
    throw new Error("Embedding vectors must have a usable magnitude.");
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function rankOkfFilesByVector(
  queryEmbedding: number[],
  sections: VectorSection[],
  limit = RETRIEVAL_TOP_K,
): RankedFile[] {
  if (limit <= 0) return [];
  const bestByFile = new Map<string, number>();
  for (const section of sections) {
    const score = cosineSimilarity(queryEmbedding, section.embedding);
    const previous = bestByFile.get(section.fileId);
    if (previous === undefined || score > previous) bestByFile.set(section.fileId, score);
  }
  return [...bestByFile]
    .map(([fileId, score]) => ({ fileId, score }))
    .sort((left, right) => right.score - left.score || compareFileIds(left.fileId, right.fileId))
    .slice(0, limit);
}

export function unionFileIds(...rankings: string[][]) {
  return [...new Set(rankings.flat())];
}
