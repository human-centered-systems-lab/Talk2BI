// /api/threads/[id]/messages

import { appendMessage, getMessages } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

export async function GET(
  req: Request,
  context: RouteContext,
) {
  try {
    const userId = await getUserId();
    const { id } = await context.params;

    const messages = await getMessages(userId, id);

    return Response.json(messages);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json(
      { error: message },
      { status },
    );
  }
}

export async function POST(
  req: Request,
  context: RouteContext,
) {
  try {
    const userId = await getUserId();
    const { id: threadId } = await context.params;

    const body = await req.json();

    const { id, role, content, createdAt } = body as {
      id: string;
      role: "user" | "assistant" | "system";
      content: unknown;
      createdAt: string;
    };

    await appendMessage(userId, {
      id,
      threadId,
      role,
      content,
      createdAt,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json(
      { error: message },
      { status },
    );
  }
}