import type {
  AppSuggestion,
  DescriptionUpdateResult,
  DomainKnowledgeDocument,
  DomainKnowledgeUploadResult,
  GraphColumn,
  GraphJoin,
  GraphJoinSuggestion,
  GraphTable,
  GraphVisualization,
  InitResult,
  JoinCreateResult,
  WarehouseDatabase,
  WarehouseTable,
} from "@/components/graph/types";

export type JoinPayload = {
  leftTableFullName: string;
  rightTableFullName: string;
  leftColumnFullName: string;
  rightColumnFullName: string;
  relationshipType: string;
};

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Request failed");
  }
  return data as T;
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function fetchDatabases(dialect: string) {
  const data = await fetch(
    `/api/graph/warehouse/databases?dialect=${encodeURIComponent(dialect)}`,
  ).then((res) => readJson<{ databases: WarehouseDatabase[] }>(res));
  return data.databases;
}

export async function fetchTables(dialect: string, database: string) {
  const data = await fetch(
    `/api/graph/warehouse/tables?dialect=${encodeURIComponent(
      dialect,
    )}&database=${encodeURIComponent(database)}`,
  ).then((res) => readJson<{ tables: WarehouseTable[] }>(res));
  return data.tables;
}

export async function fetchSchemaTables() {
  const data = await fetch("/api/graph/schema/tables").then((res) =>
    readJson<{ tables: GraphTable[] }>(res),
  );
  return data.tables;
}

export async function fetchColumns(tableFullName: string) {
  const data = await fetch(
    `/api/graph/schema/columns?tableFullName=${encodeURIComponent(
      tableFullName,
    )}`,
  ).then((res) => readJson<{ columns: GraphColumn[] }>(res));
  return data.columns;
}

export async function fetchGraphVisualization() {
  return fetch("/api/graph/schema/visualization").then((res) =>
    readJson<GraphVisualization>(res),
  );
}

export async function fetchJoins() {
  const data = await fetch("/api/graph/schema/joins").then((res) =>
    readJson<{ joins: GraphJoin[]; suggestions?: GraphJoinSuggestion[] }>(res),
  );
  return data;
}

export async function fetchDomainKnowledge() {
  const data = await fetch("/api/graph/references").then((res) =>
    readJson<{ documents: DomainKnowledgeDocument[] }>(res),
  );
  return data.documents;
}

export async function uploadDomainKnowledge(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return fetch("/api/graph/references", {
    method: "POST",
    body: formData,
  }).then((res) => readJson<DomainKnowledgeUploadResult>(res));
}

export async function updateReferenceDatasets(
  filename: string,
  datasetNames: string[],
) {
  return fetch("/api/graph/references", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, datasetNames }),
  }).then((res) =>
    readJson<{ success: true; documents: DomainKnowledgeDocument[] }>(res),
  );
}

export async function deleteReference(filename: string) {
  return fetch("/api/graph/references", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  }).then((res) =>
    readJson<{
      success: true;
      documents: DomainKnowledgeDocument[];
      deletedChunks: number;
    }>(res),
  );
}

export async function fetchAppSuggestions() {
  const data = await fetch("/api/graph/suggestions").then((res) =>
    readJson<{ suggestions: AppSuggestion[] }>(res),
  );
  return data.suggestions;
}

export async function generateAppSuggestions(model: string) {
  const data = await fetch("/api/graph/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  }).then((res) => readJson<{ suggestions: AppSuggestion[] }>(res));
  return data.suggestions;
}

export async function updateAppSuggestion(suggestion: AppSuggestion) {
  const data = await fetch("/api/graph/suggestions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(suggestion),
  }).then((res) => readJson<{ suggestions: AppSuggestion[] }>(res));
  return data.suggestions;
}

export async function deleteAppSuggestion(id: string) {
  return fetch("/api/graph/suggestions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).then((res) => readJson<{ success: true; deletedCount: number }>(res));
}

export async function syncGraphDatabase(
  database: string,
  dialect: string,
  tables: WarehouseTable[],
) {
  return fetch("/api/graph/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "sync-database",
      database,
      dialect,
      tables,
    }),
  }).then((res) => readJson<InitResult>(res));
}

export async function removeGraphDatabase(database: string) {
  return fetch("/api/graph/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "remove-database", database }),
  }).then((res) => readJson<{ success: true; database: string }>(res));
}

export async function updateTableDescription(
  fullName: string,
  description: string,
) {
  return fetch("/api/graph/schema/tables", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, description }),
  }).then((res) => readJson<DescriptionUpdateResult>(res));
}

export async function updateColumnDescription(
  fullName: string,
  description: string,
  synonyms: string[],
) {
  return fetch("/api/graph/schema/columns", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, description, synonyms }),
  }).then((res) => readJson<DescriptionUpdateResult>(res));
}

export async function createJoin(payload: JoinPayload) {
  return fetch("/api/graph/schema/joins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => readJson<JoinCreateResult>(res));
}

export async function updateJoin(
  originalJoin: GraphJoin,
  payload: JoinPayload,
) {
  return fetch("/api/graph/schema/joins", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalLeftTableFullName: originalJoin.leftTableFullName,
      originalRightTableFullName: originalJoin.rightTableFullName,
      originalLeftColumnFullName: originalJoin.leftColumnFullName,
      originalRightColumnFullName: originalJoin.rightColumnFullName,
      ...payload,
    }),
  }).then((res) => readJson<JoinCreateResult>(res));
}

export async function deleteJoin(join: GraphJoin) {
  return fetch("/api/graph/schema/joins", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leftTableFullName: join.leftTableFullName,
      rightTableFullName: join.rightTableFullName,
      leftColumnFullName: join.leftColumnFullName,
      rightColumnFullName: join.rightColumnFullName,
    }),
  }).then((res) => readJson<{ success: true; deletedCount: number }>(res));
}
