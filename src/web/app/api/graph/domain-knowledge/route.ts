import { createHash } from "crypto";
import { requireGraphUser } from "@/lib/graph/auth";
import {
  createEmbeddings,
  getKnowledgeEmbeddingText,
} from "@/lib/ai/embeddings";
import {
  ensureEmbeddingIndexes,
  ensureNodeTypes,
  getNeo4jDriver,
} from "@/lib/tools/tool_read_knowledge_store";
import type { Session } from "neo4j-driver";

const MAX_MARKDOWN_BYTES = 1_000_000;
const CHUNK_TARGET_LENGTH = 1800;

type ReferenceDocument = {
  filename: string;
  title: string;
  datasetNames: string[];
  chunkCount: number;
  contentLength: number;
  updatedAt: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown reference error";
}

function getTitle(filename: string, content: string) {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));

  return heading?.replace(/^#+\s*/, "").trim() || filename.replace(/\.md$/i, "");
}

function chunkMarkdown(content: string) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [content.trim()]) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > CHUNK_TARGET_LENGTH && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);

  return chunks;
}

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function readNeo4jInteger(value: unknown) {
  return typeof value === "number" ? value : (value as { toNumber: () => number }).toNumber();
}

async function listDocuments(session: Session): Promise<ReferenceDocument[]> {
  const result = await session.run(`
    MATCH (reference:Reference)
    OPTIONAL MATCH (dataset:Dataset)-[:HAS_REFERENCE]->(reference)
    OPTIONAL MATCH (reference)-[:HAS_CHUNK]->(chunk:Chunk)
    RETURN
      reference.filename AS filename,
      reference.title AS title,
      collect(DISTINCT dataset.name) AS datasetNames,
      coalesce(reference.contentLength, 0) AS contentLength,
      toString(reference.updatedAt) AS updatedAt,
      count(DISTINCT chunk) AS chunkCount
    ORDER BY updatedAt DESC
  `);

  return result.records.map((record) => ({
    filename: record.get("filename") as string,
    title: record.get("title") as string,
    datasetNames: ((record.get("datasetNames") as Array<string | null>) ?? []).filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    ),
    contentLength: readNeo4jInteger(record.get("contentLength")),
    updatedAt: record.get("updatedAt") as string,
    chunkCount: readNeo4jInteger(record.get("chunkCount")),
  }));
}

export async function GET() {
  try {
    await requireGraphUser();
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 401 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    await ensureNodeTypes(session);
    return Response.json({ documents: await listDocuments(session) });
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

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Upload a Markdown file." }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".md")) {
    return Response.json({ error: "Only .md Markdown files are supported for now." }, { status: 400 });
  }

  if (file.size > MAX_MARKDOWN_BYTES) {
    return Response.json({ error: "Markdown file is too large." }, { status: 400 });
  }

  const content = (await file.text()).trim();
  if (!content) {
    return Response.json({ error: "Markdown file is empty." }, { status: 400 });
  }

  const filename = file.name;
  const title = getTitle(filename, content);
  const chunks = chunkMarkdown(content);
  const embeddingTexts = chunks.map((chunk) =>
    getKnowledgeEmbeddingText(title, chunk, filename),
  );
  const embeddings = await createEmbeddings(embeddingTexts);
  const embeddingDimension = embeddings[0]?.length;

  if (!embeddingDimension) {
    return Response.json({ error: "Could not determine embedding dimension." }, { status: 500 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    await ensureEmbeddingIndexes(session, embeddingDimension);
    await ensureNodeTypes(session);

    const chunkRows = chunks.map((chunk, index) => ({
      id: `${filename}#${index}`,
      chunkIndex: index,
      content: chunk,
      embeddingText: embeddingTexts[index],
      embedding: embeddings[index],
    }));

    await session.run(
      `
        MERGE (reference:Reference { filename: $filename })
        ON CREATE SET reference.createdAt = datetime()
        SET
          reference.type = "Reference",
          reference.title = $title,
          reference.contentHash = $contentHash,
          reference.contentLength = $contentLength,
          reference.updatedAt = datetime()
        WITH reference
        OPTIONAL MATCH (reference)-[:HAS_CHUNK]->(oldChunk:Chunk)
        DETACH DELETE oldChunk
        WITH reference
        UNWIND $chunks AS chunk
        CREATE (knowledgeChunk:Chunk {
          type: "Chunk",
          id: chunk.id,
          filename: $filename,
          title: $title,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          embeddingText: chunk.embeddingText,
          embedding: chunk.embedding,
          createdAt: datetime()
        })
        CREATE (reference)-[:HAS_CHUNK]->(knowledgeChunk)
      `,
      {
        filename,
        title,
        contentHash: hashContent(content),
        contentLength: content.length,
        chunks: chunkRows,
      },
    );

    return Response.json({
      success: true,
      document: {
        filename,
        title,
        chunkCount: chunks.length,
        contentLength: content.length,
        datasetNames: [],
        embeddingDimensions: embeddingDimension,
      },
      documents: await listDocuments(session),
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
    filename?: string;
    datasetNames?: string[];
  };
  const filename = body.filename?.trim() ?? "";
  const datasetNames = Array.from(
    new Set(
      (Array.isArray(body.datasetNames) ? body.datasetNames : [])
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );

  if (!filename) {
    return Response.json({ error: "Missing reference filename." }, { status: 400 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    await ensureNodeTypes(session);

    const referenceResult = await session.run(
      "MATCH (reference:Reference { filename: $filename }) RETURN reference",
      { filename },
    );
    if (referenceResult.records.length === 0) {
      return Response.json({ error: "Reference not found." }, { status: 404 });
    }

    if (datasetNames.length > 0) {
      const datasetsResult = await session.run(
        `
          MATCH (dataset:Dataset)
          WHERE dataset.name IN $datasetNames
          RETURN collect(dataset.name) AS names
        `,
        { datasetNames },
      );
      const foundNames = datasetsResult.records[0]?.get("names") as string[];
      if ((foundNames?.length ?? 0) !== datasetNames.length) {
        return Response.json({ error: "One or more datasets were not found." }, { status: 400 });
      }
    }

    await session.executeWrite(async (tx) => {
      await tx.run(
        `
          MATCH (reference:Reference { filename: $filename })
          OPTIONAL MATCH (:Dataset)-[mapping:HAS_REFERENCE]->(reference)
          DELETE mapping
        `,
        { filename },
      );

      if (datasetNames.length > 0) {
        await tx.run(
          `
            MATCH (reference:Reference { filename: $filename })
            UNWIND $datasetNames AS datasetName
            MATCH (dataset:Dataset { name: datasetName })
            MERGE (dataset)-[:HAS_REFERENCE]->(reference)
          `,
          { filename, datasetNames },
        );
      }
    });

    return Response.json({
      success: true,
      documents: await listDocuments(session),
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

  const body = (await req.json().catch(() => ({}))) as { filename?: string };
  const filename = body.filename?.trim() ?? "";

  if (!filename) {
    return Response.json({ error: "Missing reference filename." }, { status: 400 });
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return Response.json({ error: "Neo4j credentials not configured." }, { status: 500 });
  }

  let session: Session | null = null;

  try {
    session = driver.session();
    await ensureNodeTypes(session);
    const result = await session.executeWrite(async (tx) => {
      const referenceResult = await tx.run(
        `
          MATCH (reference:Reference { filename: $filename })
          OPTIONAL MATCH (reference)-[:HAS_CHUNK]->(chunk:Chunk)
          WITH reference, collect(chunk) AS chunks
          FOREACH (chunk IN chunks | DETACH DELETE chunk)
          DETACH DELETE reference
          RETURN size(chunks) AS deletedChunks
        `,
        { filename },
      );

      return referenceResult.records[0]?.get("deletedChunks");
    });

    if (result === undefined) {
      return Response.json({ error: "Reference not found." }, { status: 404 });
    }

    return Response.json({
      success: true,
      filename,
      deletedChunks: readNeo4jInteger(result),
      documents: await listDocuments(session),
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  } finally {
    await session?.close();
  }
}
