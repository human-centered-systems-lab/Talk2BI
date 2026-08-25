import path from "path";

import type { Session } from "neo4j-driver";

import {
  chunkText,
  listOkfConcepts,
  rawMarkdownSections,
  stableHash,
  type OkfBundleInput,
  type OkfConceptInput,
  type StoredOkfConcept,
} from "@/lib/okf/store";
import {
  getTableFullName,
  type WarehouseColumn,
  type WarehouseDialect,
  type WarehouseJoin,
  type WarehouseTable,
} from "@/lib/graph/types";

export const REFERENCES_BUNDLE = "talk2bi-references";

export type CatalogColumn = {
  fullName: string;
  name: string;
  sourceName: string;
  sqlIdentifier: string;
  sqlQualifiedName: string;
  dataType: string;
  ordinalPosition: number;
  description: string;
  sourceDescription?: string;
  synonyms: string[];
};

export type TableMetadata = {
  kind: "table";
  database: string;
  schema: string;
  dialect: WarehouseDialect;
  fullName: string;
  sourceName: string;
  sqlIdentifier: string;
  sqlQualifiedName: string;
  sourceDescription?: string;
  columns: CatalogColumn[];
};

export type JoinMetadata = {
  kind: "join";
  id: string;
  leftTableFullName: string;
  rightTableFullName: string;
  leftColumns: string[];
  rightColumns: string[];
  relationshipType: string;
  condition: string;
  source: "warehouse" | "manual";
};

export type ReferenceMetadata = {
  kind: "reference";
  filename: string;
  datasetNames: string[];
  contentLength: number;
  updatedAt: string;
};

export type AppConceptMetadata = TableMetadata | JoinMetadata | ReferenceMetadata;

type QuoteIdentifier = (identifier: string) => string;

function escapeCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function safeSegment(value: string) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return slug || "item";
}

export function warehouseBundleName(dialect: string, database: string) {
  return `warehouse-${safeSegment(dialect)}-${safeSegment(database)}-${stableHash(`${dialect}:${database}`, 8)}`;
}

export function tableConceptPath(fullName: string) {
  return `tables/${safeSegment(fullName)}-${stableHash(fullName, 10)}.md`;
}

export function joinConceptPath(metadata: Pick<JoinMetadata, "id">) {
  return `references/joins/${safeSegment(metadata.id)}-${stableHash(metadata.id, 10)}.md`;
}

export function referenceConceptPath(filename: string) {
  const basename = filename.replace(/\.md$/i, "");
  return `references/${safeSegment(basename)}-${stableHash(filename, 10)}.md`;
}

export function getAppMetadata(
  concept: Pick<StoredOkfConcept, "extraFrontmatter"> | Pick<OkfConceptInput, "extraFrontmatter">,
): AppConceptMetadata | null {
  const container = concept.extraFrontmatter;
  const value = container?.talk2bi;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  return metadata.kind === "table" || metadata.kind === "join" || metadata.kind === "reference"
    ? (metadata as AppConceptMetadata)
    : null;
}

function withMetadata(metadata: AppConceptMetadata) {
  return { talk2bi: metadata };
}

function quotedQualifiedName(
  table: WarehouseTable,
  quoteIdentifier: QuoteIdentifier,
) {
  return [table.database, table.schema, table.name].map(quoteIdentifier).join(".");
}

export function mergeWarehouseDescription(
  sourceDescription: string | undefined,
  previousDescription?: string,
  previousSourceDescription?: string,
) {
  const source = sourceDescription?.trim() ?? "";
  if (previousDescription === undefined) return source;
  if (previousSourceDescription === undefined) {
    return previousDescription.trim() ? previousDescription : source;
  }
  return previousDescription === previousSourceDescription
    ? source
    : previousDescription;
}

function buildColumns(
  table: WarehouseTable,
  columns: WarehouseColumn[],
  quoteIdentifier: QuoteIdentifier,
  old?: TableMetadata,
) {
  const oldByName = new Map((old?.columns ?? []).map((column) => [column.sourceName, column]));
  const tableSql = quotedQualifiedName(table, quoteIdentifier);
  return columns
    .filter((column) => getTableFullName(column) === getTableFullName(table))
    .map((column): CatalogColumn => {
      const previous = oldByName.get(column.column);
      const sourceDescription = column.description?.trim() ?? "";
      return {
        fullName: `${getTableFullName(table)}.${column.column}`,
        name: `${table.schema}.${table.name}.${column.column}`,
        sourceName: column.column,
        sqlIdentifier: quoteIdentifier(column.column),
        sqlQualifiedName: `${tableSql}.${quoteIdentifier(column.column)}`,
        dataType: column.dataType,
        ordinalPosition: column.ordinalPosition,
        description: mergeWarehouseDescription(
          sourceDescription,
          previous?.description,
          previous?.sourceDescription,
        ),
        sourceDescription,
        synonyms: previous?.synonyms ?? [],
      };
    })
    .sort((left, right) => left.ordinalPosition - right.ordinalPosition);
}

function joinMetadataFromWarehouse(join: WarehouseJoin): JoinMetadata {
  const leftTableFullName = getTableFullName(join.source);
  const rightTableFullName = getTableFullName(join.target);
  const leftColumns = join.columns.map((column) => column.source);
  const rightColumns = join.columns.map((column) => column.target);
  const condition = join.columns
    .map((column) => `${leftTableFullName}.${column.source} = ${rightTableFullName}.${column.target}`)
    .join(" AND ");
  return {
    kind: "join",
    id: stableHash({ leftTableFullName, rightTableFullName, leftColumns, rightColumns }, 24),
    leftTableFullName,
    rightTableFullName,
    leftColumns,
    rightColumns,
    relationshipType: "",
    condition,
    source: "warehouse",
  };
}

function tableLink(fromPath: string, targetFullName: string) {
  return path.posix.relative(path.posix.dirname(fromPath), tableConceptPath(targetFullName));
}

function joinLink(fromPath: string, metadata: JoinMetadata) {
  return path.posix.relative(path.posix.dirname(fromPath), joinConceptPath(metadata));
}

export function renderTableBody(metadata: TableMetadata, joins: JoinMetadata[]) {
  const rows = metadata.columns.map(
    (column) =>
      `| \`${escapeCell(column.sourceName)}\` | ${escapeCell(column.dataType)} | NULLABLE | ${escapeCell(column.description)} | ${escapeCell(column.synonyms.join(", "))} |  |  |  |`,
  );
  const relevantJoins = joins.filter(
    (join) =>
      join.leftTableFullName === metadata.fullName ||
      join.rightTableFullName === metadata.fullName,
  );
  const joinLines = relevantJoins.map((join) => {
    const other = join.leftTableFullName === metadata.fullName
      ? join.rightTableFullName
      : join.leftTableFullName;
    return `- [${other}](${joinLink(tableConceptPath(metadata.fullName), join)}) — ${join.condition}.`;
  });
  return [
    `${metadata.dialect} table with ${metadata.columns.length} columns.`,
    "",
    "# Schema",
    "",
    "| Column | Type | Mode | Description | Synonyms | Example Values | Distinct Count | Null Count |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "# Join Candidates",
    "",
    ...(joinLines.length ? joinLines : ["No join candidates are currently documented."]),
  ].join("\n");
}

export function renderJoinBody(metadata: JoinMetadata) {
  const ownPath = joinConceptPath(metadata);
  const pairs = metadata.leftColumns.map(
    (left, index) => `| \`${escapeCell(left)}\` | \`${escapeCell(metadata.rightColumns[index] ?? "")}\` |`,
  );
  return [
    `Join between [${metadata.leftTableFullName}](${tableLink(ownPath, metadata.leftTableFullName)}) and [${metadata.rightTableFullName}](${tableLink(ownPath, metadata.rightTableFullName)}).`,
    "",
    "# Join",
    "",
    `Relationship type: ${metadata.relationshipType || "unspecified"}.`,
    "",
    `SQL condition: \`${metadata.condition}\``,
    "",
    "| Left Column | Right Column |",
    "|---|---|",
    ...pairs,
  ].join("\n");
}

function tableInput(metadata: TableMetadata, description: string, joins: JoinMetadata[]): OkfConceptInput {
  return {
    path: tableConceptPath(metadata.fullName),
    type: `${metadata.dialect} Table`,
    title: metadata.fullName,
    description,
    resource: metadata.sqlQualifiedName,
    tags: [metadata.dialect, metadata.database, metadata.schema],
    status: "stable",
    body: renderTableBody(metadata, joins),
    extraFrontmatter: withMetadata(metadata),
  };
}

export function joinInput(metadata: JoinMetadata): OkfConceptInput {
  return {
    path: joinConceptPath(metadata),
    type: "Reference",
    title: `${metadata.leftTableFullName} to ${metadata.rightTableFullName}`,
    description: `Join metadata for ${metadata.condition}`,
    tags: ["join", metadata.source],
    status: "stable",
    body: renderJoinBody(metadata),
    extraFrontmatter: withMetadata(metadata),
  };
}

export function buildWarehouseBundle(options: {
  database: string;
  dialect: WarehouseDialect;
  tables: WarehouseTable[];
  columns: WarehouseColumn[];
  joins: WarehouseJoin[];
  quoteIdentifier: QuoteIdentifier;
  existing?: StoredOkfConcept[];
}): OkfBundleInput {
  const oldTables = new Map<string, { metadata: TableMetadata; description: string }>();
  for (const concept of options.existing ?? []) {
    const metadata = getAppMetadata(concept);
    if (metadata?.kind === "table") {
      oldTables.set(metadata.fullName, { metadata, description: concept.description });
    }
  }
  const joins = options.joins.map(joinMetadataFromWarehouse);
  const tableConcepts = options.tables.map((table) => {
    const fullName = getTableFullName(table);
    const previous = oldTables.get(fullName);
    const sourceDescription = table.description?.trim() ?? "";
    const metadata: TableMetadata = {
      kind: "table",
      database: table.database,
      schema: table.schema,
      dialect: options.dialect,
      fullName,
      sourceName: table.name,
      sqlIdentifier: options.quoteIdentifier(table.name),
      sqlQualifiedName: quotedQualifiedName(table, options.quoteIdentifier),
      sourceDescription,
      columns: buildColumns(table, options.columns, options.quoteIdentifier, previous?.metadata),
    };
    return tableInput(
      metadata,
      mergeWarehouseDescription(
        sourceDescription,
        previous?.description,
        previous?.metadata.sourceDescription,
      ),
      joins,
    );
  });
  return {
    name: warehouseBundleName(options.dialect, options.database),
    properties: {
      source_database: options.database,
      dialect: options.dialect,
      managed_by: "talk2bi",
    },
    concepts: [...tableConcepts, ...joins.map(joinInput)],
  };
}

export function rebuildTableBodies(concepts: OkfConceptInput[]) {
  const joins = concepts
    .map((concept) => getAppMetadata(concept))
    .filter((metadata): metadata is JoinMetadata => metadata?.kind === "join");
  return concepts.map((concept) => {
    const metadata = getAppMetadata(concept);
    if (metadata?.kind !== "table") return concept;
    return { ...concept, body: renderTableBody(metadata, joins) };
  });
}

export async function listCatalogTables(session: Session) {
  const concepts = await listOkfConcepts(session, { readyOnly: true });
  return concepts.flatMap((concept) => {
    const metadata = getAppMetadata(concept);
    if (metadata?.kind !== "table") return [];
    return [{ concept, metadata }];
  });
}

export async function listCatalogJoins(session: Session) {
  const concepts = await listOkfConcepts(session, { readyOnly: true });
  return concepts.flatMap((concept) => {
    const metadata = getAppMetadata(concept);
    if (metadata?.kind !== "join") return [];
    return [{ concept, metadata }];
  });
}

export async function listCatalogReferences(session: Session) {
  const concepts = await listOkfConcepts(session, {
    bundle: REFERENCES_BUNDLE,
    readyOnly: true,
  });
  return concepts.flatMap((concept) => {
    const metadata = getAppMetadata(concept);
    if (metadata?.kind !== "reference") return [];
    return [{ concept, metadata }];
  });
}

export function referenceInput(options: {
  filename: string;
  title: string;
  body: string;
  datasetNames?: string[];
  updatedAt?: string;
}): OkfConceptInput {
  const metadata: ReferenceMetadata = {
    kind: "reference",
    filename: options.filename,
    datasetNames: Array.from(new Set(options.datasetNames ?? [])),
    contentLength: options.body.length,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  };
  return {
    path: referenceConceptPath(options.filename),
    type: "Reference",
    title: options.title,
    description: `Domain knowledge from ${options.filename}`,
    tags: ["domain-knowledge", ...metadata.datasetNames],
    status: "stable",
    body: options.body.trim(),
    extraFrontmatter: withMetadata(metadata),
  };
}

export function sectionCount(body: string) {
  return rawMarkdownSections(body).reduce(
    (count, section) => count + chunkText(section.text).length,
    0,
  );
}
