import { createHash, randomUUID } from "crypto";
import path from "path";

import neo4j, {
  type Driver,
  type Integer,
  type ManagedTransaction,
  type Session,
} from "neo4j-driver";

export const OKF_VERSION = "0.2";
export const SECTION_MAX_CHARS = 2_400;

const CORE_LABELS = new Set([
  "OKFNode",
  "Bundle",
  "Concept",
  "Section",
  "Source",
  "Actor",
  "Tag",
  "LogEntry",
  "Artifact",
  "Stub",
]);
const SAFE_LABEL = /^[A-Za-z_][A-Za-z0-9_]*$/;
const H1 = /^#\s+(.+?)\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const MARKDOWN_LINK = /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

let driver: Driver | null = null;

export type OkfConceptInput = {
  path: string;
  type: string;
  title: string;
  body: string;
  description?: string;
  resource?: string;
  tags?: string[];
  status?: string;
  staleAfter?: string | null;
  generatedAt?: string | null;
  trustTier?: string;
  extraFrontmatter?: Record<string, unknown>;
  runtime?: string | null;
  parametersJson?: string | null;
  receipt?: string[] | null;
  executorRaw?: string | null;
  attesterRaw?: string | null;
  computationRaw?: string | null;
};

export type OkfBundleInput = {
  name: string;
  root?: string;
  concepts: OkfConceptInput[];
  properties?: Record<string, string | number | boolean | null>;
};

export type StoredOkfConcept = {
  uid: string;
  bundle: string;
  id: string;
  path: string;
  type: string;
  typeLabel: string;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  status: string;
  body: string;
  extraFrontmatter: Record<string, unknown>;
};

export type OkfFileCard = {
  file_id: string;
  type: string;
  title: string;
  tags: string[];
  headings: string[];
  description: string;
  columns: string[];
};

export type StoredOkfSection = {
  uid: string;
  fileId: string;
  text: string;
  textHash: string;
  embedding: number[] | null;
  embeddingModel: string;
  embeddingStrategy: string;
  embeddingDimensions: number;
};

type SectionRow = {
  uid: string;
  bundle: string;
  heading: string;
  order: number;
  part: number;
  text: string;
  text_hash: string;
  char_count: number;
  sync_run: string;
};

type ConceptRow = {
  uid: string;
  bundle: string;
  id: string;
  path: string;
  dir: string;
  type: string;
  type_label: string;
  title: string;
  description: string | null;
  resource: string | null;
  tags: string[];
  status: string;
  stale_after: string | null;
  generated_at: string | null;
  trust_tier: string;
  extra_frontmatter: string | null;
  runtime: string | null;
  parameters_json: string | null;
  receipt: string[] | null;
  executor_raw: string | null;
  attester_raw: string | null;
  computation_raw: string | null;
  body: string;
  stub: false;
  sync_run: string;
};

type LinkRow = {
  uid: string;
  source_uid: string;
  section_uid: string;
  target_uid: string;
  target_id: string;
  text: string;
  section: string;
  raw: string;
  resolved: boolean;
};

export function getNeo4jDriver(): Driver | null {
  if (driver) return driver;
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER ?? process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !user || !password) return null;
  driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return driver;
}

export async function closeNeo4jDriver() {
  await driver?.close();
  driver = null;
}

export function getNeo4jSession(graphDriver: Driver) {
  return graphDriver.session(
    process.env.NEO4J_DATABASE
      ? { database: process.env.NEO4J_DATABASE }
      : undefined,
  );
}

export function toNumber(value: unknown): number {
  return typeof value === "number"
    ? value
    : neo4j.isInt(value)
      ? (value as Integer).toNumber()
      : Number(value ?? 0);
}

export function stableHash(value: unknown, length?: number) {
  const serialized = stableJson(value);
  const hash = createHash("sha256").update(serialized).digest("hex");
  return length ? hash.slice(0, length) : hash;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function conceptTypeLabel(conceptType: string) {
  const words = conceptType.match(/[A-Za-z0-9]+/g) ?? [];
  let label = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");
  if (!label) throw new Error(`Could not derive a graph label from type ${conceptType}.`);
  if (/^[0-9]/.test(label)) label = `Type${label}`;
  if (CORE_LABELS.has(label)) label = `OKFType${label}`;
  if (!SAFE_LABEL.test(label)) throw new Error(`Unsafe graph label ${label}.`);
  return label;
}

export function rawMarkdownSections(body: string) {
  const sections: Array<{ heading: string; level: number; text: string }> = [];
  let heading = "_preamble";
  let level = 0;
  let lines: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      lines.push(line);
      continue;
    }
    const match = fence ? null : line.match(H1);
    if (match) {
      const text = lines.join("\n").trim();
      if (text) sections.push({ heading, level, text });
      heading = match[1]!.replace(/\s+#+\s*$/, "").trim();
      level = 1;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  const text = lines.join("\n").trim();
  if (text) sections.push({ heading, level, text });
  return sections;
}

function chunkMarkdownTable(block: string, maxChars: number): string[] | null {
  const lines = block.split("\n");
  if (
    lines.length < 3 ||
    !TABLE_DELIMITER.test(lines[1]!) ||
    !lines[0]!.includes("|") ||
    lines.slice(2).some((line) => !line.includes("|"))
  ) return null;
  const header = `${lines[0]}\n${lines[1]}`;
  if (header.length >= maxChars) throw new Error("Markdown table header exceeds section limit.");
  const payloadLimit = maxChars - header.length - 1;
  const chunks: string[] = [];
  let rows: string[] = [];
  const finish = () => {
    if (rows.length) chunks.push(`${header}\n${rows.join("\n")}`);
    rows = [];
  };
  for (const rowValue of lines.slice(2)) {
    let row = rowValue;
    const candidate = [...rows, row].join("\n");
    if (candidate.length <= payloadLimit) {
      rows.push(row);
      continue;
    }
    finish();
    if (row.length <= payloadLimit) {
      rows.push(row);
      continue;
    }
    while (row.length > payloadLimit) {
      chunks.push(`${header}\n${row.slice(0, payloadLimit)}`);
      row = row.slice(payloadLimit);
    }
    if (row) rows.push(row);
  }
  finish();
  return chunks;
}

export function chunkText(text: string, maxChars = SECTION_MAX_CHARS): string[] {
  if (maxChars < 256) throw new Error("Section chunk size must be at least 256 characters.");
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const rawBlock of text.split(/\n\s*\n/)) {
    const block = rawBlock.trim();
    if (!block) continue;
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    current = "";
    if (block.length <= maxChars) {
      current = block;
      continue;
    }
    const tableChunks = chunkMarkdownTable(block, maxChars);
    if (tableChunks) {
      chunks.push(...tableChunks);
      continue;
    }
    for (let line of block.split("\n")) {
      const lineCandidate = current ? `${current}\n${line}` : line;
      if (lineCandidate.length <= maxChars) {
        current = lineCandidate;
        continue;
      }
      if (current) chunks.push(current);
      current = "";
      while (line.length > maxChars) {
        chunks.push(line.slice(0, maxChars));
        line = line.slice(maxChars);
      }
      current = line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function normalizeConceptPath(value: string) {
  const normalized = path.posix.normalize(value.replace(/^\/+/, ""));
  if (!normalized.endsWith(".md") || normalized.startsWith("../") || normalized === "../") {
    throw new Error(`Invalid OKF concept path ${value}.`);
  }
  return normalized;
}

function makeRows(bundle: OkfBundleInput, runId: string) {
  const bundleUid = `okf-bundle:${bundle.name}`;
  const conceptRows: ConceptRow[] = [];
  const sectionRows: SectionRow[] = [];
  const sectionsByConcept = new Map<string, SectionRow[]>();
  const conceptsById = new Map<string, ConceptRow>();

  for (const input of bundle.concepts) {
    const relativePath = normalizeConceptPath(input.path);
    const id = relativePath.slice(0, -3);
    const uid = `${bundleUid}:concept:${id}`;
    const row: ConceptRow = {
      uid,
      bundle: bundle.name,
      id,
      path: relativePath,
      dir: path.posix.dirname(id) === "." ? "" : path.posix.dirname(id),
      type: input.type || "Concept",
      type_label: conceptTypeLabel(input.type || "Concept"),
      title: input.title || path.posix.basename(id),
      description: input.description?.trim() || null,
      resource: input.resource?.trim() || null,
      tags: Array.from(new Set(input.tags ?? [])),
      status: input.status ?? "stable",
      stale_after: input.staleAfter ?? null,
      generated_at: input.generatedAt ?? null,
      trust_tier: input.trustTier ?? "unverified",
      extra_frontmatter: input.extraFrontmatter
        ? JSON.stringify(input.extraFrontmatter)
        : null,
      runtime: input.runtime ?? null,
      parameters_json: input.parametersJson ?? null,
      receipt: input.receipt ?? null,
      executor_raw: input.executorRaw ?? null,
      attester_raw: input.attesterRaw ?? null,
      computation_raw: input.computationRaw ?? null,
      body: input.body.trim(),
      stub: false,
      sync_run: runId,
    };
    if (conceptsById.has(id)) throw new Error(`Duplicate OKF concept ${id}.`);
    conceptsById.set(id, row);
    conceptRows.push(row);
    const ownSections: SectionRow[] = [];
    let order = 0;
    for (const raw of rawMarkdownSections(row.body)) {
      const chunks = chunkText(raw.text);
      chunks.forEach((text, chunkIndex) => {
        const section: SectionRow = {
          uid: `${uid}#section:${order}`,
          bundle: bundle.name,
          heading: raw.heading,
          order,
          part: chunkIndex + 1,
          text,
          text_hash: stableHash(text),
          char_count: text.length,
          sync_run: runId,
        };
        sectionRows.push(section);
        ownSections.push(section);
        order += 1;
      });
    }
    sectionsByConcept.set(uid, ownSections);
  }

  const stubs = new Map<string, Record<string, unknown>>();
  const links: LinkRow[] = [];
  for (const concept of conceptRows) {
    for (const section of sectionsByConcept.get(concept.uid) ?? []) {
      let match: RegExpExecArray | null;
      MARKDOWN_LINK.lastIndex = 0;
      while ((match = MARKDOWN_LINK.exec(section.text))) {
        const raw = match[2]!;
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
        const rawPath = raw.split(/[?#]/, 1)[0];
        if (!rawPath?.toLowerCase().endsWith(".md")) continue;
        const resolvedPath = path.posix.normalize(
          rawPath.startsWith("/")
            ? rawPath.slice(1)
            : path.posix.join(path.posix.dirname(concept.id), rawPath),
        );
        if (resolvedPath.startsWith("../") || resolvedPath === "../") continue;
        let targetId = resolvedPath.slice(0, -3);
        if (!conceptsById.has(targetId)) {
          const rootId = path.posix.normalize(rawPath.replace(/^\/+/, "")).slice(0, -3);
          if (conceptsById.has(rootId)) targetId = rootId;
        }
        const target = conceptsById.get(targetId);
        const targetUid = target?.uid ?? `${bundleUid}:concept:${targetId}`;
        if (!target) {
          stubs.set(targetUid, {
            uid: targetUid,
            bundle: bundle.name,
            id: targetId,
            path: `${targetId}.md`,
            dir: path.posix.dirname(targetId) === "." ? "" : path.posix.dirname(targetId),
            title: path.posix.basename(targetId).replace(/[-_]/g, " "),
            stub: true,
            type: "Concept",
            status: "draft",
            sync_run: runId,
          });
        }
        const key = [concept.uid, targetUid, section.uid, raw];
        if (links.some((item) => item.uid === `${bundleUid}:link:${stableHash(key, 24)}`)) continue;
        links.push({
          uid: `${bundleUid}:link:${stableHash(key, 24)}`,
          source_uid: concept.uid,
          section_uid: section.uid,
          target_uid: targetUid,
          target_id: targetId,
          text: match[1]!,
          section: section.heading,
          raw,
          resolved: Boolean(target),
        });
      }
    }
  }

  return {
    bundleUid,
    conceptRows,
    sectionRows,
    sectionsByConcept,
    stubs: [...stubs.values()],
    links,
  };
}

export async function ensureOkfSchema(session: Session) {
  const statements = [
    "CREATE CONSTRAINT okf_node_uid IF NOT EXISTS FOR (n:OKFNode) REQUIRE n.uid IS UNIQUE",
    "CREATE INDEX okf_concept_bundle_name IF NOT EXISTS FOR (n:Concept) ON (n.bundle)",
    "CREATE INDEX okf_concept_type IF NOT EXISTS FOR (n:Concept) ON (n.type)",
    "CREATE INDEX okf_concept_status IF NOT EXISTS FOR (n:Concept) ON (n.status)",
    "CREATE INDEX okf_section_bundle_name IF NOT EXISTS FOR (n:Section) ON (n.bundle)",
    "CREATE FULLTEXT INDEX okf_section_fulltext IF NOT EXISTS FOR (n:Section) ON EACH [n.heading, n.text]",
  ];
  for (const statement of statements) await session.run(statement);
}

async function syncRows(tx: ManagedTransaction, bundle: OkfBundleInput, runId: string) {
  const rows = makeRows(bundle, runId);
  const existing = await tx.run(
    `MATCH (c:OKFNode:Concept {bundle: $bundle})
     RETURN c.uid AS uid, c.type_label AS typeLabel`,
    { bundle: bundle.name },
  );
  const labelsByUid = new Map(rows.conceptRows.map((row) => [row.uid, row.type_label]));
  for (const record of existing.records) {
    const uid = record.get("uid") as string;
    const oldLabel = record.get("typeLabel") as string | null;
    if (oldLabel && oldLabel !== labelsByUid.get(uid) && SAFE_LABEL.test(oldLabel)) {
      await tx.run(`MATCH (c:Concept {uid: $uid}) REMOVE c:\`${oldLabel}\``, { uid });
    }
  }

  await tx.run(
    `MATCH (n:OKFNode)-[r]->()
     WHERE (n.bundle = $bundle OR n.bundle_uid = $bundleUid)
       AND type(r) IN $types
     DELETE r`,
    {
      bundle: bundle.name,
      bundleUid: rows.bundleUid,
      types: ["IN_BUNDLE", "TAGGED", "HAS_SECTION", "NEXT", "LINKS_TO", "MENTIONS"],
    },
  );
  await tx.run(
    `MATCH (n:OKFNode:Concept:Stub {bundle: $bundle}) DETACH DELETE n`,
    { bundle: bundle.name },
  );

  for (const label of new Set(rows.conceptRows.map((row) => row.type_label))) {
    const selected = rows.conceptRows.filter((row) => row.type_label === label);
    await tx.run(
      `UNWIND $rows AS row
       MERGE (n:OKFNode:Concept:\`${label}\` {uid: row.uid})
       SET n += row,
           n.stale_after = CASE WHEN row.stale_after IS NULL THEN null ELSE date(row.stale_after) END,
           n.generated_at = CASE WHEN row.generated_at IS NULL THEN null ELSE datetime(row.generated_at) END
       REMOVE n:Stub, n.bundle_uid, n.concept_id, n.directory`,
      { rows: selected },
    );
  }
  await tx.run(
    `UNWIND $rows AS row
     MERGE (n:OKFNode:Section {uid: row.uid})
     WITH n, row, n.text_hash AS oldHash, n.embedding AS oldEmbedding,
          n.embedding_model AS oldModel, n.embedding_dimensions AS oldDimensions
     SET n += row,
         n.embedding = CASE WHEN oldHash = row.text_hash THEN oldEmbedding ELSE null END,
         n.embedding_model = CASE WHEN oldHash = row.text_hash THEN oldModel ELSE null END,
         n.embedding_dimensions = CASE WHEN oldHash = row.text_hash THEN oldDimensions ELSE null END
     REMOVE n.bundle_uid, n.level, n.chunk`,
    { rows: rows.sectionRows },
  );
  if (rows.stubs.length) {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (n:OKFNode:Concept:Stub {uid: row.uid})
       SET n += row, n.type = 'Concept', n.status = 'draft'`,
      { rows: rows.stubs },
    );
  }

  const tags = Array.from(new Set(rows.conceptRows.flatMap((row) => row.tags))).map((name) => ({
    uid: `okf-tag:${stableHash(name, 24)}`,
    name,
  }));
  if (tags.length) {
    await tx.run(
      "UNWIND $rows AS row MERGE (n:OKFNode:Tag {uid: row.uid}) SET n += row",
      { rows: tags },
    );
  }
  await tx.run(
    `UNWIND $rows AS row
     MATCH (c:OKFNode:Concept {uid: row.uid}), (b:OKFNode:Bundle {uid: $bundleUid})
     MERGE (c)-[:IN_BUNDLE]->(b)`,
    { rows: rows.conceptRows, bundleUid: rows.bundleUid },
  );
  const tagLinks = rows.conceptRows.flatMap((row) =>
    row.tags.map((tag) => ({ from: row.uid, to: `okf-tag:${stableHash(tag, 24)}` })),
  );
  if (tagLinks.length) {
    await tx.run(
      `UNWIND $rows AS row MATCH (a:OKFNode {uid: row.from}), (b:OKFNode {uid: row.to})
       MERGE (a)-[:TAGGED]->(b)`,
      { rows: tagLinks },
    );
  }
  const sectionLinks = rows.conceptRows.flatMap((concept) =>
    (rows.sectionsByConcept.get(concept.uid) ?? []).map((section) => ({
      from: concept.uid,
      to: section.uid,
      order: section.order,
    })),
  );
  if (sectionLinks.length) {
    await tx.run(
      `UNWIND $rows AS row MATCH (a:Concept {uid: row.from}), (b:Section {uid: row.to})
       MERGE (a)-[r:HAS_SECTION]->(b) SET r.order = row.order`,
      { rows: sectionLinks },
    );
  }
  const nextLinks = rows.conceptRows.flatMap((concept) => {
    const sections = rows.sectionsByConcept.get(concept.uid) ?? [];
    return sections.slice(1).map((section, index) => ({
      from: sections[index]!.uid,
      to: section.uid,
    }));
  });
  if (nextLinks.length) {
    await tx.run(
      `UNWIND $rows AS row MATCH (a:OKFNode {uid: row.from}), (b:OKFNode {uid: row.to})
       MERGE (a)-[:NEXT]->(b)`,
      { rows: nextLinks },
    );
  }
  if (rows.links.length) {
    await tx.run(
      `UNWIND $rows AS row
       MATCH (a:Concept {uid: row.source_uid}), (s:Section {uid: row.section_uid}),
             (b:Concept {uid: row.target_uid})
       MERGE (a)-[r:LINKS_TO {uid: row.uid}]->(b)
       SET r.text = row.text, r.section = row.section, r.raw = row.raw,
           r.section_uid = row.section_uid, r.resolved = row.resolved
       MERGE (s)-[m:MENTIONS {uid: row.uid}]->(b)
       SET m.text = row.text, m.raw = row.raw, m.resolved = row.resolved`,
      { rows: rows.links },
    );
  }
  await tx.run(
    `MATCH (n:OKFNode)
     WHERE (n.bundle = $bundle OR n.bundle_uid = $bundleUid)
       AND NOT n:Bundle AND coalesce(n.sync_run, '') <> $runId
     DETACH DELETE n`,
    { bundle: bundle.name, bundleUid: rows.bundleUid, runId },
  );
  await tx.run(
    `MATCH (b:Bundle {uid: $bundleUid})
     SET b.sync_state = 'ready', b.last_completed_run = $runId,
         b.concept_count = $conceptCount, b.section_count = $sectionCount,
         b.link_count = $linkCount, b.stub_count = $stubCount`,
    {
      bundleUid: rows.bundleUid,
      runId,
      conceptCount: rows.conceptRows.length,
      sectionCount: rows.sectionRows.length,
      linkCount: rows.links.length,
      stubCount: rows.stubs.length,
    },
  );
  await tx.run("MATCH (t:OKFNode:Tag) WHERE NOT (t)--() DELETE t");
  return rows;
}

export async function syncOkfBundle(session: Session, bundle: OkfBundleInput) {
  await ensureOkfSchema(session);
  const runId = randomUUID().replaceAll("-", "");
  const bundleUid = `okf-bundle:${bundle.name}`;
  await session.run(
    `MERGE (b:OKFNode:Bundle {uid: $uid})
     SET b.name = $name, b.okf_version = $version, b.root = $root,
         b.sync_state = 'building', b.sync_run = $runId, b += $properties`,
    {
      uid: bundleUid,
      name: bundle.name,
      version: OKF_VERSION,
      root: bundle.root ?? bundle.name,
      runId,
      properties: bundle.properties ?? {},
    },
  );
  try {
    const rows = await session.executeWrite((tx) => syncRows(tx, bundle, runId));
    return {
      bundle: bundle.name,
      concepts: rows.conceptRows.length,
      sections: rows.sectionRows.length,
      links: rows.links.length,
      stubs: rows.stubs.length,
    };
  } catch (error) {
    await session.run(
      "MATCH (b:Bundle {uid: $uid}) SET b.sync_state = 'failed', b.sync_error = $error",
      { uid: bundleUid, error: error instanceof Error ? error.message : String(error) },
    );
    throw error;
  }
}

export async function deleteOkfBundle(session: Session, bundleName: string) {
  const result = await session.run(
    `MATCH (b:OKFNode:Bundle {name: $bundle})
     OPTIONAL MATCH (n:OKFNode)-[:IN_BUNDLE]->(b)
     WITH b, collect(n) AS nodes
     FOREACH (node IN nodes | DETACH DELETE node)
     DETACH DELETE b
     RETURN size(nodes) AS deleted`,
    { bundle: bundleName },
  );
  await session.run("MATCH (t:OKFNode:Tag) WHERE NOT (t)--() DELETE t");
  return toNumber(result.records[0]?.get("deleted"));
}

export async function listOkfConcepts(
  session: Session,
  options: { bundle?: string; includeStubs?: boolean; readyOnly?: boolean } = {},
) {
  const result = await session.run(
    `MATCH (c:OKFNode:Concept)-[:IN_BUNDLE]->(b:OKFNode:Bundle)
     WHERE ($bundle IS NULL OR b.name = $bundle)
       AND ($includeStubs OR coalesce(c.stub, false) = false)
       AND (NOT $readyOnly OR b.sync_state = 'ready')
     RETURN c.uid AS uid, b.name AS bundle, c.id AS id, c.path AS path,
            c.type AS type, c.type_label AS typeLabel, c.title AS title,
            coalesce(c.description, '') AS description,
            coalesce(c.resource, '') AS resource, coalesce(c.tags, []) AS tags,
            coalesce(c.status, 'stable') AS status, coalesce(c.body, '') AS body,
            c.extra_frontmatter AS extraFrontmatter
     ORDER BY b.name, c.path`,
    {
      bundle: options.bundle ?? null,
      includeStubs: options.includeStubs ?? false,
      readyOnly: options.readyOnly ?? false,
    },
  );
  return result.records.map((record): StoredOkfConcept => ({
    uid: record.get("uid") as string,
    bundle: record.get("bundle") as string,
    id: record.get("id") as string,
    path: record.get("path") as string,
    type: record.get("type") as string,
    typeLabel: (record.get("typeLabel") as string | null) ?? "Concept",
    title: record.get("title") as string,
    description: record.get("description") as string,
    resource: record.get("resource") as string,
    tags: (record.get("tags") as string[]) ?? [],
    status: record.get("status") as string,
    body: record.get("body") as string,
    extraFrontmatter: parseExtraFrontmatter(record.get("extraFrontmatter")),
  }));
}

export function parseExtraFrontmatter(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function getOkfConcept(session: Session, uid: string) {
  const concepts = await listOkfConcepts(session);
  return concepts.find((concept) => concept.uid === uid) ?? null;
}

export async function replaceConceptInBundle(
  session: Session,
  bundleName: string,
  updated: OkfConceptInput,
) {
  const concepts = await listOkfConcepts(session, { bundle: bundleName });
  const bundleResult = await session.run(
    `MATCH (b:Bundle {name: $bundle}) RETURN b.root AS root,
      properties(b) AS properties`,
    { bundle: bundleName },
  );
  if (!bundleResult.records.length) throw new Error("OKF bundle not found.");
  const bundleProperties = bundleResult.records[0]!.get("properties") as Record<string, unknown>;
  const inputs = concepts.map(conceptToInput);
  const index = inputs.findIndex((concept) => concept.path === normalizeConceptPath(updated.path));
  if (index < 0) throw new Error("OKF concept not found.");
  inputs[index] = updated;
  const properties = Object.fromEntries(
    Object.entries(bundleProperties).filter(
      ([key, value]) =>
        !["uid", "name", "okf_version", "root", "sync_state", "sync_run", "sync_error", "last_completed_run", "concept_count", "section_count", "link_count", "stub_count"].includes(key) &&
        ["string", "number", "boolean"].includes(typeof value),
    ),
  ) as Record<string, string | number | boolean>;
  return syncOkfBundle(session, {
    name: bundleName,
    root: (bundleResult.records[0]!.get("root") as string | null) ?? bundleName,
    properties,
    concepts: inputs,
  });
}

export function conceptToInput(concept: StoredOkfConcept): OkfConceptInput {
  return {
    path: concept.path,
    type: concept.type,
    title: concept.title,
    description: concept.description,
    resource: concept.resource,
    tags: concept.tags,
    status: concept.status,
    body: concept.body,
    extraFrontmatter: concept.extraFrontmatter,
  };
}

export async function replaceBundleConcepts(
  session: Session,
  bundleName: string,
  transform: (concepts: OkfConceptInput[]) => OkfConceptInput[],
) {
  const concepts = await listOkfConcepts(session, { bundle: bundleName });
  const bundleResult = await session.run(
    "MATCH (b:Bundle {name: $bundle}) RETURN properties(b) AS properties",
    { bundle: bundleName },
  );
  if (!bundleResult.records.length) throw new Error("OKF bundle not found.");
  const raw = bundleResult.records[0]!.get("properties") as Record<string, unknown>;
  const properties = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) =>
        !["uid", "name", "okf_version", "root", "sync_state", "sync_run", "sync_error", "last_completed_run", "concept_count", "section_count", "link_count", "stub_count"].includes(key) &&
        ["string", "number", "boolean"].includes(typeof value),
    ),
  ) as Record<string, string | number | boolean>;
  return syncOkfBundle(session, {
    name: bundleName,
    root: (raw.root as string | undefined) ?? bundleName,
    properties,
    concepts: transform(concepts.map(conceptToInput)),
  });
}

function markdownCells(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export function extractColumnNames(body: string) {
  const lines = body.split(/\r?\n/);
  const output: string[] = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const header = lines[index]!.includes("|") ? markdownCells(lines[index]!) : [];
    const delimiter = lines[index + 1]!.includes("|") ? markdownCells(lines[index + 1]!) : [];
    if (
      header[0]?.toLowerCase() !== "column" ||
      delimiter.length !== header.length ||
      !delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) continue;
    index += 2;
    while (index < lines.length && lines[index]!.trimStart().startsWith("|")) {
      const raw = markdownCells(lines[index]!)[0]?.trim() ?? "";
      const name = raw.replace(/^`|`$/g, "").replace(/^"|"$/g, "").trim();
      if (name && !output.some((item) => item.toLowerCase() === name.toLowerCase())) output.push(name);
      index += 1;
    }
  }
  return output;
}

export function renderOkfDocument(fileId: string, concept: StoredOkfConcept) {
  const fields: Array<[string, unknown]> = [
    ["type", concept.type],
    ["title", concept.title],
    ["description", concept.description || null],
    ["resource", concept.resource || null],
    ["tags", concept.tags.length ? concept.tags : null],
    ["status", concept.status],
  ];
  const frontmatter = fields
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `<!-- okf-file: ${fileId} -->\n\n---\n${frontmatter}\n---\n\n${concept.body}`.trim();
}

export async function readAllOkfFiles(session: Session) {
  const concepts = await listOkfConcepts(session, { readyOnly: true });
  const result = new Map<string, { card: OkfFileCard; markdown: string }>();
  for (const concept of concepts) {
    const fileId = `bundles/${concept.bundle}/${concept.path}`;
    const headings = rawMarkdownSections(concept.body)
      .map((section) => section.heading)
      .filter((heading, index, all) => heading !== "_preamble" && all.indexOf(heading) === index);
    result.set(fileId, {
      card: {
        file_id: fileId,
        type: concept.type,
        title: concept.title,
        tags: concept.tags,
        headings,
        description: concept.description,
        columns: extractColumnNames(concept.body),
      },
      markdown: renderOkfDocument(fileId, concept),
    });
  }
  return result;
}

function embeddingValues(value: unknown): number[] | null {
  if (neo4j.isVector(value)) {
    const typedArray: Iterable<number | bigint> = value.asTypedArray();
    return Array.from(typedArray, (item) => Number(item));
  }
  if (Array.isArray(value)) return value.map((item) => Number(item));
  return null;
}

export async function readAllOkfSections(session: Session) {
  const result = await session.run(
    `MATCH (c:OKFNode:Concept)-[:IN_BUNDLE]->(b:OKFNode:Bundle)
     MATCH (c)-[:HAS_SECTION]->(s:OKFNode:Section)
     WHERE b.sync_state = 'ready' AND coalesce(c.stub, false) = false
     RETURN s.uid AS uid, b.name AS bundle, c.path AS path,
            s.text AS text, s.text_hash AS textHash,
            s.embedding AS embedding,
            coalesce(s.embedding_model, '') AS embeddingModel,
            coalesce(s.embedding_strategy, '') AS embeddingStrategy,
            coalesce(s.embedding_dimensions, 0) AS embeddingDimensions
     ORDER BY b.name, c.path, s.order, s.part, s.uid`,
  );
  return result.records.map((record): StoredOkfSection => ({
    uid: record.get("uid") as string,
    fileId: `bundles/${record.get("bundle") as string}/${record.get("path") as string}`,
    text: record.get("text") as string,
    textHash: record.get("textHash") as string,
    embedding: embeddingValues(record.get("embedding")),
    embeddingModel: record.get("embeddingModel") as string,
    embeddingStrategy: record.get("embeddingStrategy") as string,
    embeddingDimensions: toNumber(record.get("embeddingDimensions")),
  }));
}

export async function writeOkfSectionEmbeddings(
  session: Session,
  rows: Array<{
    uid: string;
    textHash: string;
    embedding: number[];
    model: string;
    strategy: string;
  }>,
) {
  if (!rows.length) return 0;
  const result = await session.run(
    `UNWIND $rows AS row
     MATCH (s:OKFNode:Section {uid: row.uid})
     WHERE s.text_hash = row.textHash
     CALL db.create.setNodeVectorProperty(s, 'embedding', row.embedding)
     SET s.embedding_model = row.model,
         s.embedding_strategy = row.strategy,
         s.embedding_dimensions = size(row.embedding)
     RETURN count(s) AS updated`,
    { rows },
  );
  return toNumber(result.records[0]?.get("updated"));
}
