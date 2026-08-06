// /api/threads/[id]

import { deleteMessagesByThreadId, deleteThread, updateThread } from "@/lib/db";
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

export async function PATCH(
  req: Request,
  context: RouteContext,
) {
  try {
    const userId = await getUserId();

    const { id } = await context.params;

    const body = await req.json().catch(() => ({}));

    const { title, archived } = body as {
      title?: string;
      archived?: boolean;
    };

    await updateThread(userId, id, {
      ...(title !== undefined ? { title } : {}),
      ...(archived !== undefined ? { archived } : {}),
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

export async function DELETE(
  req: Request,
  context: RouteContext,
) {
  try {
    const userId = await getUserId();

    const { id } = await context.params;

    await deleteMessagesByThreadId(userId, id);
    await deleteThread(userId, id);

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