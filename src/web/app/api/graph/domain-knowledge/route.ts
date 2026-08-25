import type { Session } from "neo4j-driver";

import { requireGraphUser } from "@/lib/graph/auth";
import {
  getAppMetadata,
  listCatalogReferences,
  REFERENCES_BUNDLE,
  referenceInput,
  sectionCount,
  type ReferenceMetadata,
} from "@/lib/okf/catalog";
import {
  conceptToInput,
  deleteOkfBundle,
  getNeo4jDriver,
  getNeo4jSession,
  replaceBundleConcepts,
  syncOkfBundle,
  type OkfConceptInput,
} from "@/lib/okf/store";

const MAX_MARKDOWN_BYTES = 1_000_000;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown reference error";
}

function titleFromMarkdown(filename: string, content: string) {
  const heading = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("#"));
  return heading?.replace(/^#+\s*/, "").trim() || filename.replace(/\.md$/i, "");
}

function documentResponse(concept: Awaited<ReturnType<typeof listCatalogReferences>>[number]) {
  return {
    filename: concept.metadata.filename,
    title: concept.concept.title,
    datasetNames: concept.metadata.datasetNames,
    chunkCount: sectionCount(concept.concept.body),
    contentLength: concept.metadata.contentLength,
    updatedAt: concept.metadata.updatedAt,
  };
}

async function documents(session: Session) {
  return (await listCatalogReferences(session))
    .map(documentResponse)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function requireSession() {
  await requireGraphUser();
  const graphDriver = getNeo4jDriver();
  if (!graphDriver) throw new Error("Neo4j credentials not configured.");
  return getNeo4jSession(graphDriver);
}

export async function GET() {
  let session: Session | null = null;
  try {
    session = await requireSession();
    return Response.json({ documents: await documents(session) });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  } finally {
    await session?.close();
  }
}

export async function POST(req: Request) {
  let session: Session | null = null;
  try {
    session = await requireSession();
    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Upload a Markdown file." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".md")) return Response.json({ error: "Only .md Markdown files are supported." }, { status: 400 });
    if (file.size > MAX_MARKDOWN_BYTES) return Response.json({ error: "Markdown file is too large." }, { status: 400 });
    const content = (await file.text()).trim();
    if (!content) return Response.json({ error: "Markdown file is empty." }, { status: 400 });

    const existing = await listCatalogReferences(session);
    const previous = existing.find(({ metadata }) => metadata.filename === file.name);
    const input = referenceInput({
      filename: file.name,
      title: titleFromMarkdown(file.name, content),
      body: content,
      datasetNames: previous?.metadata.datasetNames ?? [],
    });
    const concepts = existing
      .filter(({ metadata }) => metadata.filename !== file.name)
      .map(({ concept }) => conceptToInput(concept));
    await syncOkfBundle(session, {
      name: REFERENCES_BUNDLE,
      properties: { managed_by: "talk2bi", purpose: "domain-knowledge" },
      concepts: [...concepts, input],
    });
    const currentDocuments = await documents(session);
    const current = currentDocuments.find((document) => document.filename === file.name)!;
    return Response.json({
      success: true,
      document: current,
      documents: currentDocuments,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  } finally {
    await session?.close();
  }
}

export async function PATCH(req: Request) {
  let session: Session | null = null;
  try {
    session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { filename?: string; datasetNames?: unknown };
    if (!body.filename) return Response.json({ error: "Filename is required." }, { status: 400 });
    const datasetNames = Array.isArray(body.datasetNames)
      ? Array.from(new Set(body.datasetNames.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)))
      : [];
    let found = false;
    await replaceBundleConcepts(session, REFERENCES_BUNDLE, (concepts) =>
      concepts.map((concept): OkfConceptInput => {
        const metadata = getAppMetadata(concept);
        if (metadata?.kind !== "reference" || metadata.filename !== body.filename) return concept;
        found = true;
        const updated: ReferenceMetadata = { ...metadata, datasetNames, updatedAt: new Date().toISOString() };
        return {
          ...concept,
          tags: ["domain-knowledge", ...datasetNames],
          extraFrontmatter: { talk2bi: updated },
        };
      }),
    );
    if (!found) return Response.json({ error: "Reference not found." }, { status: 404 });
    return Response.json({ success: true, documents: await documents(session) });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  } finally {
    await session?.close();
  }
}

export async function DELETE(req: Request) {
  let session: Session | null = null;
  try {
    session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { filename?: string };
    if (!body.filename) return Response.json({ error: "Filename is required." }, { status: 400 });
    const existing = await listCatalogReferences(session);
    const target = existing.find(({ metadata }) => metadata.filename === body.filename);
    if (!target) return Response.json({ error: "Reference not found." }, { status: 404 });
    const remaining = existing.filter(({ metadata }) => metadata.filename !== body.filename);
    if (remaining.length) {
      await syncOkfBundle(session, {
        name: REFERENCES_BUNDLE,
        properties: { managed_by: "talk2bi", purpose: "domain-knowledge" },
        concepts: remaining.map(({ concept }) => conceptToInput(concept)),
      });
    } else {
      await deleteOkfBundle(session, REFERENCES_BUNDLE);
    }
    return Response.json({
      success: true,
      deletedChunks: sectionCount(target.concept.body),
      documents: await documents(session),
    });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  } finally {
    await session?.close();
  }
}
