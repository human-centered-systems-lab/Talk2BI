// /api/threads
// ------------

import {
  archiveAllThreads,
  createThread,
  deleteAllThreads,
  getThreads,
} from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function getUserId(): Promise<string> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user.id;
}

export async function GET() {
  try {
    const userId = await getUserId();

    const threads = await getThreads(userId);

    return Response.json(threads);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await getUserId();

    const body = await req.json().catch(() => ({}));
    const { id, title } = body as { id?: string; title?: string };

    const thread = await createThread(userId, id, title);

    return Response.json(thread);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}

export async function PATCH() {
  try {
    const userId = await getUserId();
    const archivedCount = await archiveAllThreads(userId);
    return Response.json({ success: true, archivedCount });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function DELETE() {
  try {
    const userId = await getUserId();
    const deletedCount = await deleteAllThreads(userId);
    return Response.json({ success: true, deletedCount });
  } catch (error) {
    const message = getErrorMessage(error);
    return Response.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
