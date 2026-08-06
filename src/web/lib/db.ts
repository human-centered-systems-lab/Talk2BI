// Server-side Supabase-backed storage for thread & message persistence.

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";

const CHAT_HISTORY_ENABLED =
  (process.env.CHAT_HISTORY_ENABLED ?? "true").toLowerCase() === "true";

const CHAT_THREADS_TABLE = process.env.CHAT_THREADS_TABLE ?? "chat_threads";
const CHAT_MESSAGES_TABLE = process.env.CHAT_MESSAGES_TABLE ?? "chat_messages";
const EVALUATION_CASES_TABLE =
  process.env.EVALUATION_CASES_TABLE ?? "evaluation_cases";
const EVALUATION_RUNS_TABLE =
  process.env.EVALUATION_RUNS_TABLE ?? "evaluation_runs";
const LINKS_CLICKED_TABLE = "links_clicked";

async function getSupabase() {
  return createServerSupabaseClient();
}

export type ThreadRecord = {
  id: string;
  userId: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: unknown;
  createdAt: string;
};

type MessageRow = Omit<MessageRecord, "content"> & {
  content: string | unknown;
};

export type LinkClickRecord = {
  id: number;
  userId: string;
  linkId: string;
  clickedAt: string;
};

export type EvaluationCaseRecord = {
  id: string;
  userId: string;
  question: string;
  goldSql: string;
  createdAt: string;
  updatedAt: string;
};

export type EvaluationRunRecord = {
  id: string;
  userId: string;
  caseId: string;
  question: string;
  goldSql: string;
  answerText: string | null;
  finalSql: string | null;
  executedSql: string | null;
  status: "success" | "error";
  error: string | null;
  toolTrace: unknown;
  createdAt: string;
};

export async function getThreads(
  userId: string,
): Promise<ThreadRecord[]> {
  if (!CHAT_HISTORY_ENABLED) return [];

  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(CHAT_THREADS_TABLE)
    .select("*")
    .eq("userId", userId)
    .order("updatedAt", { ascending: false });

  if (error) throw error;

  return (data ?? []) as ThreadRecord[];
}

export async function createThread(
  userId: string,
  id?: string,
  title?: string,
): Promise<ThreadRecord> {
  const now = new Date().toISOString();

  const thread: ThreadRecord = {
    id: id ?? crypto.randomUUID(),
    userId,
    title: title?.trim() || "Chat",
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  if (!CHAT_HISTORY_ENABLED) {
    return thread;
  }

  const supabase = await getSupabase();

  const { error } = await supabase
    .from(CHAT_THREADS_TABLE)
    .upsert(thread);

  if (error) throw error;

  return thread;
}

export async function updateThread(
  userId: string,
  id: string,
  updates: Partial<Pick<ThreadRecord, "title" | "archived">>,
): Promise<void> {
  if (!CHAT_HISTORY_ENABLED) return;

  const supabase = await getSupabase();

  const payload: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (updates.title !== undefined) {
    payload.title = updates.title.trim() || "Chat";
  }

  if (updates.archived !== undefined) {
    payload.archived = updates.archived;
  }

  const { error } = await supabase
    .from(CHAT_THREADS_TABLE)
    .update(payload)
    .eq("id", id)
    .eq("userId", userId);

  if (error) throw error;
}

export async function deleteThread(
  userId: string,
  id: string,
): Promise<void> {
  if (!CHAT_HISTORY_ENABLED) return;

  const supabase = await getSupabase();

  const { error } = await supabase
    .from(CHAT_THREADS_TABLE)
    .delete()
    .eq("id", id)
    .eq("userId", userId);

  if (error) throw error;
}

export async function archiveAllThreads(userId: string): Promise<number> {
  if (!CHAT_HISTORY_ENABLED) return 0;

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from(CHAT_THREADS_TABLE)
    .update({
      archived: true,
      updatedAt: new Date().toISOString(),
    })
    .eq("userId", userId)
    .eq("archived", false)
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

export async function deleteAllThreads(userId: string): Promise<number> {
  if (!CHAT_HISTORY_ENABLED) return 0;

  const supabase = await getSupabase();
  const { data: threads, error: threadsError } = await supabase
    .from(CHAT_THREADS_TABLE)
    .select("id")
    .eq("userId", userId);

  if (threadsError) throw threadsError;

  const threadIds = (threads ?? []).map((thread) => thread.id as string);
  if (threadIds.length === 0) return 0;

  const { error: messagesError } = await supabase
    .from(CHAT_MESSAGES_TABLE)
    .delete()
    .in("threadId", threadIds);

  if (messagesError) throw messagesError;

  const { error: deleteThreadsError } = await supabase
    .from(CHAT_THREADS_TABLE)
    .delete()
    .eq("userId", userId);

  if (deleteThreadsError) throw deleteThreadsError;
  return threadIds.length;
}

export async function getMessages(
  userId: string,
  threadId: string,
): Promise<MessageRecord[]> {
  if (!CHAT_HISTORY_ENABLED) return [];

  const supabase = await getSupabase();

  const { data: thread } = await supabase
    .from(CHAT_THREADS_TABLE)
    .select("id")
    .eq("id", threadId)
    .eq("userId", userId)
    .single();

  if (!thread) {
    return [];
  }

  const { data, error } = await supabase
    .from(CHAT_MESSAGES_TABLE)
    .select("*")
    .eq("threadId", threadId)
    .order("createdAt", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as MessageRow[]).map((row) => ({
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content:
      typeof row.content === "string"
        ? JSON.parse(row.content)
        : row.content,
    createdAt: row.createdAt,
  }));
}

export async function appendMessage(
  userId: string,
  message: MessageRecord,
): Promise<void> {
  if (!CHAT_HISTORY_ENABLED) return;

  const supabase = await getSupabase();

  const { data: thread } = await supabase
    .from(CHAT_THREADS_TABLE)
    .select("id")
    .eq("id", message.threadId)
    .eq("userId", userId)
    .single();

  if (!thread) {
    return;
  }

  const { error } = await supabase
    .from(CHAT_MESSAGES_TABLE)
    .insert({
      id: message.id,
      threadId: message.threadId,
      role: message.role,
      content: JSON.stringify(message.content ?? null),
      createdAt: message.createdAt,
    });

  if (error) throw error;

  await supabase
    .from(CHAT_THREADS_TABLE)
    .update({
      updatedAt: new Date().toISOString(),
    })
    .eq("id", message.threadId);
}

export async function deleteMessagesByThreadId(
  userId: string,
  threadId: string,
): Promise<void> {
  if (!CHAT_HISTORY_ENABLED) return;

  const supabase = await getSupabase();

  const { data: thread } = await supabase
    .from(CHAT_THREADS_TABLE)
    .select("id")
    .eq("id", threadId)
    .eq("userId", userId)
    .single();

  if (!thread) {
    return;
  }

  const { error } = await supabase
    .from(CHAT_MESSAGES_TABLE)
    .delete()
    .eq("threadId", threadId);

  if (error) throw error;
}

export async function registerLinkClick(
  userId: string,
  linkId: string,
): Promise<void> {
  if (!CHAT_HISTORY_ENABLED) return;

  const supabase = await getSupabase();

  const { error } = await supabase
    .from(LINKS_CLICKED_TABLE)
    .insert({
      userId,
      linkId,
      clickedAt: new Date().toISOString(),
    });

  if (error) throw error;
}

export async function getEvaluationCases(
  userId: string,
): Promise<EvaluationCaseRecord[]> {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(EVALUATION_CASES_TABLE)
    .select("*")
    .eq("userId", userId)
    .order("createdAt", { ascending: true });

  if (error) throw error;

  return (data ?? []) as EvaluationCaseRecord[];
}

export async function getEvaluationCase(
  userId: string,
  id: string,
): Promise<EvaluationCaseRecord | null> {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(EVALUATION_CASES_TABLE)
    .select("*")
    .eq("userId", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return (data as EvaluationCaseRecord | null) ?? null;
}

export async function createEvaluationCase(
  userId: string,
  input: Pick<EvaluationCaseRecord, "id" | "question" | "goldSql">,
): Promise<EvaluationCaseRecord> {
  const now = new Date().toISOString();

  const record: EvaluationCaseRecord = {
    id: input.id,
    userId,
    question: input.question,
    goldSql: input.goldSql,
    createdAt: now,
    updatedAt: now,
  };

  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(EVALUATION_CASES_TABLE)
    .insert(record)
    .select("*")
    .single();

  if (error) throw error;

  return data as EvaluationCaseRecord;
}

export async function updateEvaluationCase(
  userId: string,
  id: string,
  input: Pick<EvaluationCaseRecord, "question" | "goldSql">,
): Promise<EvaluationCaseRecord> {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(EVALUATION_CASES_TABLE)
    .update({
      question: input.question,
      goldSql: input.goldSql,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("userId", userId)
    .select("*")
    .single();

  if (error) throw error;

  return data as EvaluationCaseRecord;
}

export async function deleteEvaluationCase(
  userId: string,
  id: string,
): Promise<void> {
  const supabase = await getSupabase();

  const { error } = await supabase
    .from(EVALUATION_CASES_TABLE)
    .delete()
    .eq("id", id)
    .eq("userId", userId);

  if (error) throw error;
}

export async function getEvaluationRuns(
  userId: string,
): Promise<EvaluationRunRecord[]> {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(EVALUATION_RUNS_TABLE)
    .select("*")
    .eq("userId", userId)
    .order("createdAt", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as EvaluationRunRecord[]).map(normalizeEvaluationRun);
}

export async function createEvaluationRun(
  userId: string,
  input: Omit<EvaluationRunRecord, "id" | "userId" | "createdAt">,
): Promise<EvaluationRunRecord> {
  const record = {
    id: crypto.randomUUID(),
    userId,
    ...input,
    createdAt: new Date().toISOString(),
  };

  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(EVALUATION_RUNS_TABLE)
    .insert(record)
    .select("*")
    .single();

  if (error) throw error;

  return normalizeEvaluationRun(data as EvaluationRunRecord);
}

export async function deleteEvaluationRun(
  userId: string,
  id: string,
): Promise<void> {
  const supabase = await getSupabase();

  const { error } = await supabase
    .from(EVALUATION_RUNS_TABLE)
    .delete()
    .eq("id", id)
    .eq("userId", userId);

  if (error) throw error;
}

function normalizeEvaluationRun(row: EvaluationRunRecord): EvaluationRunRecord {
  return {
    ...row,
    toolTrace:
      typeof row.toolTrace === "string"
        ? JSON.parse(row.toolTrace)
        : row.toolTrace,
  };
}
