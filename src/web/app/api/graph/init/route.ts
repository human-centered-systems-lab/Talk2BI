import { requireGraphUser } from "@/lib/graph/auth";
import {
  createEmbeddings,
  getColumnEmbeddingText,
  getTableEmbeddingText,
} from "@/lib/ai/embeddings";
import {
  getTableFullName,
  normalizeDialect,
  WAREHOUSE_DIALECTS,
  type WarehouseColumn,
  type WarehouseJoin,
  type WarehouseTable,
} from "@/lib/graph/types";
import { getWarehouseProvider } from "@/lib/graph/warehouse";
import {
  ensureEmbeddingIndexes,
  ensureNodeTypes,
  getNeo4jDriver,
} from "@/lib/tools/tool_read_knowledge_store";
import type { Session } from "neo4j-driver";

type InitRequest = {
  tables?: WarehouseTable[];
  database?: string;
  dialect?: string;
  mode?: "replace" | "sync-database" | "remove-database";
};

type QuoteIdentifier = (identifier: string) => string;

type TableNode = {
  type: string;
  sourceName: string;
  fullName: string;
  sqlIdentifier: string;
  sqlQualifiedName: string;
  description: string;
  embeddingText: string;
};

type ColumnNode = {
  type: string;
  tableFullName: string;
  fullName: string;
  name: string;
  sourceName: string;
  sqlIdentifier: string;
  sqlQualifiedName: string;
  dataType: string;
  ordinalPosition: number;
  description: string;
  synonyms: string[];
  embeddingText: string;
};

type JoinRelationship = {
  sourceTableFullName: string;
  targetTableFullName: string;
  // Neo4j properties must be primitives or arrays of primitives, so the column
  // pairs are stored as two parallel arrays plus a readable condition.
  sourceColumns: string[];
  targetColumns: string[];
  condition: string;
};

type ExistingColumnMetadata = {
  description: string;
  synonyms: string[];
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown graph init error";
}

function getTableNodeName(table: WarehouseTable) {
  return `${table.schema}.${table.name}`;
}

function getTableSqlQualifiedName(
  table: WarehouseTable,
  quoteIdentifier: QuoteIdentifier,
) {
  return [
    quoteIdentifier(table.database),
    quoteIdentifier(table.schema),
    quoteIdentifier(table.name),
  ].join(".");
}

function getColumnSqlQualifiedName(
  column: WarehouseColumn,
  quoteIdentifier: QuoteIdentifier,
) {
  return `${getTableSqlQualifiedName(column, quoteIdentifier)}.${quoteIdentifier(
    column.column,
  )}`;
}

function getValidTables(tables: unknown): WarehouseTable[] {
  if (!Array.isArray(tables)) return [];

  return tables.filter(
    (table): table is WarehouseTable => {
      if (!table || typeof table !== "object") return false;

      const candidate = table as Partial<WarehouseTable>;

      return (
        typeof candidate.database === "string" &&
        typeof candidate.schema === "string" &&
        typeof candidate.name === "string" &&
        candidate.database.length > 0 &&
        candidate.schema.length > 0 &&
        candidate.name.length > 0
      );
    },
  );
}

function buildTableNodes(
  tables: WarehouseTable[],
  dialect: string,
  quoteIdentifier: QuoteIdentifier,
  descriptions: Map<string, string> = new Map(),
): TableNode[] {
  return tables.map((table) => {
    const description = descriptions.get(getTableFullName(table)) ?? "";

    return {
      type: `${dialect} Table`,
      sourceName: table.name,
      fullName: getTableFullName(table),
      sqlIdentifier: quoteIdentifier(table.name),
      sqlQualifiedName: getTableSqlQualifiedName(table, quoteIdentifier),
      description,
      embeddingText: getTableEmbeddingText(getTableNodeName(table), description),
    };
  });
}

function buildColumnNodes(
  columns: WarehouseColumn[],
  dialect: string,
  quoteIdentifier: QuoteIdentifier,
  metadata: Map<string, ExistingColumnMetadata> = new Map(),
): ColumnNode[] {
  return columns.map((column) => {
    const name = `${getTableNodeName(column)}.${column.column}`;
    const existing = metadata.get(`${getTableFullName(column)}.${column.column}`);
    const description = existing?.description ?? "";
    const synonyms = existing?.synonyms ?? [];

    return {
      type: `${dialect} Column`,
      tableFullName: getTableFullName(column),
      fullName: `${getTableFullName(column)}.${column.column}`,
      name,
      sourceName: column.column,
      sqlIdentifier: quoteIdentifier(column.column),
      sqlQualifiedName: getColumnSqlQualifiedName(column, quoteIdentifier),
      dataType: column.dataType,
      ordinalPosition: column.ordinalPosition,
      description,
      synonyms,
      embeddingText: getColumnEmbeddingText(name, description, synonyms),
    };
  });
}

async function loadExistingMetadata(session: Session, database: string) {
  const tableDescriptions = new Map<string, string>();
  const columnMetadata = new Map<string, ExistingColumnMetadata>();
  if (!database) return { tableDescriptions, columnMetadata };

  const result = await session.run(
    `
      MATCH (:Dataset { name: $database })-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(table:Table)
      OPTIONAL MATCH (table)-[:HAS_COLUMN]->(column:Column)
      RETURN
        table.fullName AS tableFullName,
        coalesce(table.description, "") AS tableDescription,
        column.fullName AS columnFullName,
        coalesce(column.description, "") AS columnDescription,
        coalesce(column.synonyms, []) AS columnSynonyms
    `,
    { database },
  );

  result.records.forEach((record) => {
    const tableFullName = record.get("tableFullName") as string;
    tableDescriptions.set(
      tableFullName,
      record.get("tableDescription") as string,
    );

    const columnFullName = record.get("columnFullName") as string | null;
    if (columnFullName) {
      columnMetadata.set(columnFullName, {
        description: record.get("columnDescription") as string,
        synonyms: record.get("columnSynonyms") as string[],
      });
    }
  });

  return { tableDescriptions, columnMetadata };
}

function buildJoinRelationships(joins: WarehouseJoin[]): JoinRelationship[] {
  return joins.map((join) => {
    const sourceTableFullName = getTableFullName(join.source);
    const targetTableFullName = getTableFullName(join.target);

    return {
      sourceTableFullName,
      targetTableFullName,
      sourceColumns: join.columns.map((column) => column.source),
      targetColumns: join.columns.map((column) => column.target),
      condition: join.columns
        .map(
          (column) =>
            `${sourceTableFullName}.${column.source} = ${targetTableFullName}.${column.target}`,
        )
        .join(" AND "),
    };
  });
}

function buildSchemaNodes(tables: WarehouseTable[], dialect: string) {
  const schemas = new Map<
    string,
    {
      datasetName: string;
      dialect: string;
      name: string;
      fullName: string;
      tableFullNames: string[];
    }
  >();

  tables.forEach((table) => {
    const fullName = `${table.database}.${table.schema}`;
    const schema = schemas.get(fullName) ?? {
      datasetName: table.database,
      dialect,
      name: table.schema,
      fullName,
      tableFullNames: [],
    };

    schema.tableFullNames.push(getTableFullName(table));
    schemas.set(fullName, schema);
  });

  return Array.from(schemas.values());
}

export async function POST(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as InitRequest;
  const tables = body.tables ?? [];
  const mode = body.mode ?? "replace";
  const database = body.database?.trim() ?? "";
  const dialect = body.dialect?.trim() || "Snowflake";

  if ((mode === "sync-database" || mode === "remove-database") && !database) {
    return Response.json({ error: "Missing database." }, { status: 400 });
  }

  if (mode !== "remove-database" && !normalizeDialect(dialect)) {
    return Response.json(
      {
        error: `Unsupported dialect "${dialect}". Supported dialects: ${WAREHOUSE_DIALECTS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const driver = getNeo4jDriver();

  if (!driver) {
    return Response.json(
      {
        error:
          "Neo4j credentials not configured. Please set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD.",
      },
      { status: 500 },
    );
  }

  if (mode === "remove-database") {
    let session: Session | null = null;

    try {
      session = driver.session();
      await ensureNodeTypes(session);
      await session.executeWrite(async (tx) => {
        await tx.run(
          `
            MATCH (:Dataset { name: $database })-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(table:Table)-[:HAS_COLUMN]->(column:Column)
            DETACH DELETE column
          `,
          { database },
        );
        await tx.run(
          `
            MATCH (:Dataset { name: $database })-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(table:Table)
            DETACH DELETE table
          `,
          { database },
        );
        await tx.run(
          `
            MATCH (:Dataset { name: $database })-[:HAS_SCHEMA]->(schema:Schema)
            DETACH DELETE schema
          `,
          { database },
        );
        await tx.run(
          `
            MATCH (dataset:Dataset { name: $database })
            DETACH DELETE dataset
          `,
          { database },
        );
      });

      return Response.json({ success: true, database });
    } catch (error) {
      return Response.json({ error: getErrorMessage(error) }, { status: 500 });
    } finally {
      await session?.close();
    }
  }

  if (!Array.isArray(tables) || tables.length === 0) {
    return Response.json(
      { error: "Select at least one table." },
      { status: 400 },
    );
  }

  const validTables = getValidTables(tables);

  if (validTables.length === 0) {
    return Response.json(
      { error: "No valid table selections were provided." },
      { status: 400 },
    );
  }

  if (
    mode === "sync-database" &&
    validTables.some((table) => table.database !== database)
  ) {
    return Response.json(
      { error: "Every selected table must belong to the chosen database." },
      { status: 400 },
    );
  }

  let session: Session | null = null;

  try {
    const provider = getWarehouseProvider(dialect);
    const columns = await provider.listColumns(validTables);
    const joins = await provider.listJoins(validTables);
    session = driver.session();
    await ensureNodeTypes(session);
    const existingMetadata =
      mode === "sync-database"
        ? await loadExistingMetadata(session, database)
        : {
            tableDescriptions: new Map<string, string>(),
            columnMetadata: new Map<string, ExistingColumnMetadata>(),
          };
    const tableNodes = buildTableNodes(
      validTables,
      provider.dialect,
      provider.quoteIdentifier,
      existingMetadata.tableDescriptions,
    );
    const columnNodes = buildColumnNodes(
      columns,
      provider.dialect,
      provider.quoteIdentifier,
      existingMetadata.columnMetadata,
    );
    const joinRelationships = buildJoinRelationships(joins);
    const tableEmbeddings = await createEmbeddings(
      tableNodes.map((table) => table.embeddingText),
    );
    const columnEmbeddings = await createEmbeddings(
      columnNodes.map((column) => column.embeddingText),
    );
    const embeddingDimension = tableEmbeddings[0]?.length ?? columnEmbeddings[0]?.length;

    if (!embeddingDimension) {
      return Response.json(
        { error: "Could not determine embedding dimension." },
        { status: 500 },
      );
    }

    await ensureEmbeddingIndexes(session, embeddingDimension, {
      recreate: mode === "replace",
    });
    const tablesToCreate = tableNodes.map((table, index) => ({
      ...table,
      embedding: tableEmbeddings[index],
    }));
    const columnsToCreate = columnNodes.map((column, index) => ({
      ...column,
      embedding: columnEmbeddings[index],
    }));

    await session.executeWrite(async (tx) => {
      if (mode === "sync-database") {
        await tx.run(
          `
            MATCH (:Dataset { name: $database })-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(table:Table)-[:HAS_COLUMN]->(column:Column)
            DETACH DELETE column
          `,
          { database },
        );
        await tx.run(
          `
            MATCH (:Dataset { name: $database })-[:HAS_SCHEMA]->(:Schema)-[:HAS_TABLE]->(table:Table)
            DETACH DELETE table
          `,
          { database },
        );
        await tx.run(
          `
            MATCH (:Dataset { name: $database })-[:HAS_SCHEMA]->(schema:Schema)
            DETACH DELETE schema
          `,
          { database },
        );
      } else {
        await tx.run("MATCH (n) DETACH DELETE n");
      }
      await tx.run(
        `
          UNWIND $tables AS table
          CREATE (:Table {
            type: table.type,
            sourceName: table.sourceName,
            fullName: table.fullName,
            sqlIdentifier: table.sqlIdentifier,
            sqlQualifiedName: table.sqlQualifiedName,
            description: table.description,
            embeddingText: table.embeddingText,
            embedding: table.embedding
          })
        `,
        {
          tables: tablesToCreate,
        },
      );
      await tx.run(
        `
          UNWIND $schemas AS schema
          MERGE (dataset:Dataset { name: schema.datasetName })
          SET
            dataset.type = "Dataset",
            dataset.dialect = schema.dialect
          MERGE (schemaNode:Schema { fullName: schema.fullName })
          SET
            schemaNode.type = "Schema",
            schemaNode.name = schema.name
          MERGE (dataset)-[:HAS_SCHEMA]->(schemaNode)
          WITH schemaNode, schema
          UNWIND schema.tableFullNames AS tableFullName
          MATCH (table:Table { fullName: tableFullName })
          MERGE (schemaNode)-[:HAS_TABLE]->(table)
        `,
        {
          schemas: buildSchemaNodes(validTables, provider.dialect),
        },
      );
      await tx.run(
        `
          UNWIND $columns AS column
          MATCH (table:Table { fullName: column.tableFullName })
          CREATE (table)-[:HAS_COLUMN]->(:Column {
            type: column.type,
            name: column.name,
            sourceName: column.sourceName,
            sqlIdentifier: column.sqlIdentifier,
            sqlQualifiedName: column.sqlQualifiedName,
            dataType: column.dataType,
            ordinalPosition: column.ordinalPosition,
            fullName: column.fullName,
            description: column.description,
            synonyms: column.synonyms,
            embeddingText: column.embeddingText,
            embedding: column.embedding
          })
        `,
        {
          columns: columnsToCreate,
        },
      );
      await tx.run(
        `
          UNWIND $joins AS join
          MATCH (source:Table { fullName: join.sourceTableFullName })
          MATCH (target:Table { fullName: join.targetTableFullName })
          CREATE (source)-[:JOINS_ON {
            sourceColumns: join.sourceColumns,
            targetColumns: join.targetColumns,
            columnCount: size(join.sourceColumns),
            condition: join.condition
          }]->(target)
        `,
        {
          joins: joinRelationships,
        },
      );
    });

    return Response.json({
      success: true,
      tablesCreated: validTables.length,
      columnsCreated: columns.length,
      joinsCreated: joinRelationships.length,
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
