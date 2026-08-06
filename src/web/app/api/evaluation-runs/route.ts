import { deleteEvaluationRun, getEvaluationRuns } from "@/lib/db";
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
    const runs = await getEvaluationRuns(userId);

    return Response.json(runs);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({ error: "Missing run id." }, { status: 400 });
    }

    await deleteEvaluationRun(userId, id);

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}
