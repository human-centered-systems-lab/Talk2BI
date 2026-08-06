import { requireGraphUser } from "@/lib/graph/auth";
import { getNeo4jDriver } from "@/lib/tools/tool_read_knowledge_store";
import type { Session } from "neo4j-driver";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown schema graph error";
}

function readRequiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNeo4jInteger(value: unknown) {
  if (typeof value === "number") return value;
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    return value.toNumber() as number;
  }
  return 0;
}

type GraphJoin = {
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

type ColumnForSuggestion = {
  tableFullName: string;
  tableName: string;
  columnFullName: string;
  columnName: string;
  columnSourceName: string;
  dataType: string;
};

function normalizeColumnName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getColumnKey(leftColumnFullName: string, rightColumnFullName: string) {
  return [leftColumnFullName, rightColumnFullName].sort().join("::");
}

function getJoinSuggestions(
  columns: ColumnForSuggestion[],
  existingColumnJoinKeys: Set<string>,
) {
  const suggestions = new Map<
    string,
    {
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
    }
  >();

  for (let leftIndex = 0; leftIndex < columns.length; leftIndex += 1) {
    const left = columns[leftIndex];
    if (!left) continue;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < columns.length;
      rightIndex += 1
    ) {
      const right = columns[rightIndex];
      if (!right || left.tableFullName === right.tableFullName) continue;

      const key = getColumnKey(left.columnFullName, right.columnFullName);
      if (existingColumnJoinKeys.has(key)) continue;

      const leftName = normalizeColumnName(left.columnSourceName);
      const rightName = normalizeColumnName(right.columnSourceName);
      const leftIsId = leftName.endsWith("id");
      const rightIsId = rightName.endsWith("id");
      const sameName = leftName.length > 1 && leftName === rightName;
      const sameDataType =
        left.dataType &&
        right.dataType &&
        left.dataType.toLowerCase() === right.dataType.toLowerCase();

      let score = 0;
      let reason = "";

      if (sameName) {
        score = leftIsId || rightIsId ? 95 : 80;
        reason = `matching column name ${left.columnSourceName}`;
      } else if (leftIsId && rightIsId && leftName.slice(-6) === rightName.slice(-6)) {
        score = 65;
        reason = "similar identifier column names";
      }

      if (score === 0) continue;
      if (sameDataType) score += 5;

      suggestions.set(key, {
        id: `${left.columnFullName}->${right.columnFullName}:SUGGESTED_JOIN`,
        leftTableFullName: left.tableFullName,
        leftTableName: left.tableName,
        rightTableFullName: right.tableFullName,
        rightTableName: right.tableName,
        leftColumnFullName: left.columnFullName,
        leftColumnName: left.columnSourceName,
        rightColumnFullName: right.columnFullName,
        rightColumnName: right.columnSourceName,
        relationshipType: "many-to-one",
        condition: `${left.columnFullName} = ${right.columnFullName}`,
        reason,
        score,
      });
    }
  }

  return Array.from(suggestions.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
}

export async function GET() {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json(
      { error: "Neo4j credentials not configured." },
      { status: 500 },
    );
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    const result = await session.run(`
      MATCH (leftTable:Table)-[join:JOINS_ON]->(rightTable:Table)
      RETURN
        leftTable.fullName AS leftTableFullName,
        coalesce(leftTable.sourceName, leftTable.name, leftTable.fullName) AS leftTableName,
        rightTable.fullName AS rightTableFullName,
        coalesce(rightTable.sourceName, rightTable.name, rightTable.fullName) AS rightTableName,
        "" AS leftColumnFullName,
        "" AS leftColumnName,
        "" AS rightColumnFullName,
        "" AS rightColumnName,
        coalesce(join.relationshipType, "") AS relationshipType,
        coalesce(join.condition, "") AS condition,
        coalesce(join.columnCount, size(coalesce(join.sourceColumns, []))) AS columnCount
      UNION
      MATCH (leftTable:Table)-[:HAS_COLUMN]->(leftColumn:Column)-[join:JOINS_ON]->(rightColumn:Column)<-[:HAS_COLUMN]-(rightTable:Table)
      RETURN
        leftTable.fullName AS leftTableFullName,
        coalesce(leftTable.sourceName, leftTable.name, leftTable.fullName) AS leftTableName,
        rightTable.fullName AS rightTableFullName,
        coalesce(rightTable.sourceName, rightTable.name, rightTable.fullName) AS rightTableName,
        leftColumn.fullName AS leftColumnFullName,
        coalesce(leftColumn.sourceName, leftColumn.name, leftColumn.fullName) AS leftColumnName,
        rightColumn.fullName AS rightColumnFullName,
        coalesce(rightColumn.sourceName, rightColumn.name, rightColumn.fullName) AS rightColumnName,
        coalesce(join.relationshipType, "") AS relationshipType,
        coalesce(join.condition, leftColumn.fullName + " = " + rightColumn.fullName) AS condition,
        1 AS columnCount
      ORDER BY leftTableName, rightTableName, leftColumnName, rightColumnName
    `);

    const joins: GraphJoin[] = result.records.map((record) => {
        const leftTableFullName = record.get("leftTableFullName") as string;
        const rightTableFullName = record.get("rightTableFullName") as string;
        const leftColumnFullName = record.get("leftColumnFullName") as string;
        const rightColumnFullName = record.get("rightColumnFullName") as string;
        const columnCount = readNeo4jInteger(record.get("columnCount"));

        return {
          id:
            leftColumnFullName && rightColumnFullName
              ? `${leftColumnFullName}->${rightColumnFullName}:JOINS_ON`
              : `${leftTableFullName}->${rightTableFullName}:JOINS_ON`,
          leftTableFullName,
          leftTableName: record.get("leftTableName") as string,
          rightTableFullName,
          rightTableName: record.get("rightTableName") as string,
          leftColumnFullName,
          leftColumnName: record.get("leftColumnName") as string,
          rightColumnFullName,
          rightColumnName: record.get("rightColumnName") as string,
          relationshipType: record.get("relationshipType") as string,
          condition: record.get("condition") as string,
          columnCount,
        };
      });
    const existingColumnJoinKeys = new Set(
      joins
        .filter((join) => join.leftColumnFullName && join.rightColumnFullName)
        .map((join) =>
          getColumnKey(join.leftColumnFullName, join.rightColumnFullName),
        ),
    );
    const columnsResult = await session.run(`
      MATCH (table:Table)-[:HAS_COLUMN]->(column:Column)
      RETURN
        table.fullName AS tableFullName,
        coalesce(table.sourceName, table.name, table.fullName) AS tableName,
        column.fullName AS columnFullName,
        coalesce(column.name, column.fullName) AS columnName,
        coalesce(column.sourceName, column.name, column.fullName) AS columnSourceName,
        coalesce(column.dataType, "") AS dataType
      ORDER BY tableName, column.ordinalPosition, columnSourceName
    `);
    const suggestions = getJoinSuggestions(
      columnsResult.records.map((record) => ({
        tableFullName: record.get("tableFullName") as string,
        tableName: record.get("tableName") as string,
        columnFullName: record.get("columnFullName") as string,
        columnName: record.get("columnName") as string,
        columnSourceName: record.get("columnSourceName") as string,
        dataType: record.get("dataType") as string,
      })),
      existingColumnJoinKeys,
    );

    return Response.json({ joins, suggestions });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}

export async function POST(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    leftTableFullName?: unknown;
    rightTableFullName?: unknown;
    leftColumnFullName?: unknown;
    rightColumnFullName?: unknown;
    relationshipType?: unknown;
  };

  const leftTableFullName = readRequiredString(body.leftTableFullName);
  const rightTableFullName = readRequiredString(body.rightTableFullName);
  const leftColumnFullName = readRequiredString(body.leftColumnFullName);
  const rightColumnFullName = readRequiredString(body.rightColumnFullName);
  const relationshipType = readRequiredString(body.relationshipType);

  if (
    !leftTableFullName ||
    !rightTableFullName ||
    !leftColumnFullName ||
    !rightColumnFullName ||
    !relationshipType
  ) {
    return Response.json(
      { error: "Missing table, column, or relationship type." },
      { status: 400 },
    );
  }

  if (leftColumnFullName === rightColumnFullName) {
    return Response.json(
      { error: "Choose two different columns for the join." },
      { status: 400 },
    );
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json(
      { error: "Neo4j credentials not configured." },
      { status: 500 },
    );
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    const result = await session.run(
      `
        MATCH (leftTable:Table { fullName: $leftTableFullName })
          -[:HAS_COLUMN]->(leftColumn:Column { fullName: $leftColumnFullName })
        MATCH (rightTable:Table { fullName: $rightTableFullName })
          -[:HAS_COLUMN]->(rightColumn:Column { fullName: $rightColumnFullName })
        MERGE (leftColumn)-[join:JOINS_ON]->(rightColumn)
        ON CREATE SET join.createdAt = datetime()
        SET
          join.leftTable = leftTable.fullName,
          join.rightTable = rightTable.fullName,
          join.leftColumn = leftColumn.fullName,
          join.rightColumn = rightColumn.fullName,
          join.condition = leftColumn.fullName + " = " + rightColumn.fullName,
          join.relationshipType = $relationshipType,
          join.updatedAt = datetime()
        RETURN
          leftColumn.fullName AS leftColumnFullName,
          rightColumn.fullName AS rightColumnFullName,
          join.relationshipType AS relationshipType,
          join.condition AS condition
      `,
      {
        leftTableFullName,
        rightTableFullName,
        leftColumnFullName,
        rightColumnFullName,
        relationshipType,
      },
    );

    const record = result.records[0];
    if (!record) {
      return Response.json(
        { error: "Selected table or column was not found." },
        { status: 404 },
      );
    }

    return Response.json({
      success: true,
      join: {
        leftColumnFullName: record.get("leftColumnFullName") as string,
        rightColumnFullName: record.get("rightColumnFullName") as string,
        relationshipType: record.get("relationshipType") as string,
        condition: record.get("condition") as string,
      },
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}

export async function PATCH(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    originalLeftTableFullName?: unknown;
    originalRightTableFullName?: unknown;
    originalLeftColumnFullName?: unknown;
    originalRightColumnFullName?: unknown;
    leftTableFullName?: unknown;
    rightTableFullName?: unknown;
    leftColumnFullName?: unknown;
    rightColumnFullName?: unknown;
    relationshipType?: unknown;
  };

  const originalLeftTableFullName = readRequiredString(
    body.originalLeftTableFullName,
  );
  const originalRightTableFullName = readRequiredString(
    body.originalRightTableFullName,
  );
  const originalLeftColumnFullName = readRequiredString(
    body.originalLeftColumnFullName,
  );
  const originalRightColumnFullName = readRequiredString(
    body.originalRightColumnFullName,
  );
  const leftTableFullName = readRequiredString(body.leftTableFullName);
  const rightTableFullName = readRequiredString(body.rightTableFullName);
  const leftColumnFullName = readRequiredString(body.leftColumnFullName);
  const rightColumnFullName = readRequiredString(body.rightColumnFullName);
  const relationshipType = readRequiredString(body.relationshipType);

  if (
    !originalLeftTableFullName ||
    !originalRightTableFullName ||
    !originalLeftColumnFullName ||
    !originalRightColumnFullName ||
    !leftTableFullName ||
    !rightTableFullName ||
    !leftColumnFullName ||
    !rightColumnFullName ||
    !relationshipType
  ) {
    return Response.json(
      { error: "Missing table, column, or relationship type." },
      { status: 400 },
    );
  }

  if (leftColumnFullName === rightColumnFullName) {
    return Response.json(
      { error: "Choose two different columns for the join." },
      { status: 400 },
    );
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json(
      { error: "Neo4j credentials not configured." },
      { status: 500 },
    );
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    const result = await session.run(
      `
        MATCH (:Table { fullName: $originalLeftTableFullName })
          -[:HAS_COLUMN]->(:Column { fullName: $originalLeftColumnFullName })
          -[oldJoin:JOINS_ON]->
          (:Column { fullName: $originalRightColumnFullName })
          <-[:HAS_COLUMN]-(:Table { fullName: $originalRightTableFullName })
        WITH oldJoin
        DELETE oldJoin
        WITH count(*) AS deletedCount
        MATCH (leftTable:Table { fullName: $leftTableFullName })
          -[:HAS_COLUMN]->(leftColumn:Column { fullName: $leftColumnFullName })
        MATCH (rightTable:Table { fullName: $rightTableFullName })
          -[:HAS_COLUMN]->(rightColumn:Column { fullName: $rightColumnFullName })
        MERGE (leftColumn)-[join:JOINS_ON]->(rightColumn)
        ON CREATE SET join.createdAt = datetime()
        SET
          join.leftTable = leftTable.fullName,
          join.rightTable = rightTable.fullName,
          join.leftColumn = leftColumn.fullName,
          join.rightColumn = rightColumn.fullName,
          join.condition = leftColumn.fullName + " = " + rightColumn.fullName,
          join.relationshipType = $relationshipType,
          join.updatedAt = datetime()
        RETURN
          deletedCount,
          leftColumn.fullName AS leftColumnFullName,
          rightColumn.fullName AS rightColumnFullName,
          join.relationshipType AS relationshipType,
          join.condition AS condition
      `,
      {
        originalLeftTableFullName,
        originalRightTableFullName,
        originalLeftColumnFullName,
        originalRightColumnFullName,
        leftTableFullName,
        rightTableFullName,
        leftColumnFullName,
        rightColumnFullName,
        relationshipType,
      },
    );

    const record = result.records[0];
    if (!record || readNeo4jInteger(record.get("deletedCount")) === 0) {
      return Response.json({ error: "Join not found." }, { status: 404 });
    }

    return Response.json({
      success: true,
      join: {
        leftColumnFullName: record.get("leftColumnFullName") as string,
        rightColumnFullName: record.get("rightColumnFullName") as string,
        relationshipType: record.get("relationshipType") as string,
        condition: record.get("condition") as string,
      },
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}

export async function DELETE(req: Request) {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    leftTableFullName?: unknown;
    rightTableFullName?: unknown;
    leftColumnFullName?: unknown;
    rightColumnFullName?: unknown;
  };

  const leftTableFullName = readRequiredString(body.leftTableFullName);
  const rightTableFullName = readRequiredString(body.rightTableFullName);
  const leftColumnFullName = readRequiredString(body.leftColumnFullName);
  const rightColumnFullName = readRequiredString(body.rightColumnFullName);

  if (!leftTableFullName || !rightTableFullName) {
    return Response.json(
      { error: "Missing join table identifiers." },
      { status: 400 },
    );
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json(
      { error: "Neo4j credentials not configured." },
      { status: 500 },
    );
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    const result =
      leftColumnFullName && rightColumnFullName
        ? await session.run(
            `
              MATCH (:Table { fullName: $leftTableFullName })
                -[:HAS_COLUMN]->(:Column { fullName: $leftColumnFullName })
                -[join:JOINS_ON]->
                (:Column { fullName: $rightColumnFullName })
                <-[:HAS_COLUMN]-(:Table { fullName: $rightTableFullName })
              WITH join
              DELETE join
              RETURN count(*) AS deletedCount
            `,
            {
              leftTableFullName,
              rightTableFullName,
              leftColumnFullName,
              rightColumnFullName,
            },
          )
        : await session.run(
            `
              MATCH (:Table { fullName: $leftTableFullName })
                -[join:JOINS_ON]->
                (:Table { fullName: $rightTableFullName })
              WITH join
              DELETE join
              RETURN count(*) AS deletedCount
            `,
            {
              leftTableFullName,
              rightTableFullName,
            },
          );

    const deletedCount = readNeo4jInteger(
      result.records[0]?.get("deletedCount"),
    );

    if (deletedCount === 0) {
      return Response.json({ error: "Join not found." }, { status: 404 });
    }

    return Response.json({ success: true, deletedCount });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
