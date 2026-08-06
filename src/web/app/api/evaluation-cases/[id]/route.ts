import { deleteEvaluationCase, updateEvaluationCase } from "@/lib/db";
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

export async function DELETE(
  req: Request,
  context: RouteContext,
) {
  try {
    const userId = await getUserId();
    const { id } = await context.params;

    await deleteEvaluationCase(userId, id);

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}

export async function PATCH(
  req: Request,
  context: RouteContext,
) {
  try {
    const userId = await getUserId();
    const { id } = await context.params;
    const body = await req.json();
    const { question, goldSql } = body as {
      question?: string;
      goldSql?: string;
    };

    const input = {
      question: question?.trim() ?? "",
      goldSql: goldSql?.trim() ?? "",
    };

    if (!input.question || !input.goldSql) {
      return Response.json(
        { error: "question and goldSql are required" },
        { status: 400 },
      );
    }

    const evaluationCase = await updateEvaluationCase(userId, id, input);

    return Response.json(evaluationCase);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}
