// /api/threads/[id]/title

import { updateThread } from "@/lib/db";
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

export async function POST(req: Request, context: RouteContext) {
  try {
    const userId = await getUserId();
    const { id } = await context.params;

    const body = await req.json().catch(() => ({}));
    const { messages } = body as { messages?: any[] };

    let title = "Chat";

    if (Array.isArray(messages)) {
      const firstUser = messages.find((m) => m.role === "user");

      if (firstUser && Array.isArray(firstUser.content)) {
        const textParts = firstUser.content
          .filter(
            (p: any) => p.type === "text" && typeof p.text === "string",
          )
          .map((p: any) => p.text);

        const combined = textParts.join(" ").trim();

        if (combined) {
          title =
            combined.length > 40
              ? combined.slice(0, 40) + "..."
              : combined;
        }
      }
    }

    await updateThread(userId, id, { title });

    return Response.json({ title });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json(
      { error: message },
      { status },
    );
  }
}