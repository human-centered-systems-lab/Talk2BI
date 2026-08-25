export type WarehouseDatabase = {
  name: string;
};

export type WarehouseTable = {
  database: string;
  schema: string;
  name: string;
  description?: string;
};

export type InitResult = {
  tablesCreated: number;
  columnsCreated: number;
  joinsCreated?: number;
};

export type DescriptionUpdateResult = {
  success: true;
  synonyms?: string[];
};

export type JoinCreateResult = {
  success: true;
  join: {
    leftColumnFullName: string;
    rightColumnFullName: string;
    relationshipType: string;
    condition: string;
  };
};

export type GraphJoin = {
  id: string;
  leftTableFullName: string;
  leftTableName: string;
  rightTableFullName: string;
  rightTableName: string;
  leftColumnFullName: string;
  leftColumnName: string;
  rightColumnFullName: string;
  rightColumnName: string;
  relationshipType: string;
  condition: string;
  columnCount: number;
};

export type GraphJoinSuggestion = {
  id: string;
  leftTableFullName: string;
  leftTableName: string;
  rightTableFullName: string;
  rightTableName: string;
  leftColumnFullName: string;
  leftColumnName: string;
  rightColumnFullName: string;
  rightColumnName: string;
  relationshipType: string;
  condition: string;
  reason: string;
  score: number;
};

export type GraphTable = {
  fullName: string;
  name: string;
  schema: string;
  database: string;
  dialect: string;
  description: string;
  columnCount: number;
};

export type GraphColumn = {
  fullName: string;
  name: string;
  sourceName: string;
  dataType: string;
  ordinalPosition: number;
  description: string;
  synonyms: string[];
};

export type GraphVisualizationNode = {
  id: string;
  label: string;
  type:
    | "application"
    | "bundle"
    | "concept"
    | "section"
    | "tag"
    | "suggestion";
  detail: string;
};

export type GraphVisualizationEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};

export type GraphVisualization = {
  nodes: GraphVisualizationNode[];
  edges: GraphVisualizationEdge[];
};

export type DomainKnowledgeDocument = {
  filename: string;
  title: string;
  datasetNames: string[];
  chunkCount: number;
  contentLength: number;
  updatedAt: string;
};

export type DomainKnowledgeUploadResult = {
  success: true;
  document: {
    filename: string;
    title: string;
    datasetNames: string[];
    chunkCount: number;
    contentLength: number;
  };
  documents: DomainKnowledgeDocument[];
};

export type AppSuggestion = {
  id: string;
  category: string;
  label: string;
  prompt: string;
  sortOrder: number;
  model: string;
  updatedAt: string;
};

export const GRAPH_TABS = [
  "Datasets",
  "Joins",
  "References",
  "Suggestions",
  "Graph Visualization",
] as const;

export type GraphTab = (typeof GRAPH_TABS)[number];

/** Bumped by a tab whenever it changes graph content another tab renders. */
export type GraphChangeHandler = () => void;
