import {
  createEvaluationCase,
  getEvaluationCases,
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
    const cases = await getEvaluationCases(userId);

    return Response.json(cases);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await getUserId();
    const body = await req.json();
    const { id, question, goldSql } = body as {
      id?: string;
      question?: string;
      goldSql?: string;
    };

    const input = {
      id: id?.trim() ?? "",
      question: question?.trim() ?? "",
      goldSql: goldSql?.trim() ?? "",
    };

    if (!input.id || !input.question || !input.goldSql) {
      return Response.json(
        { error: "id, question, and goldSql are required" },
        { status: 400 },
      );
    }

    const evaluationCase = await createEvaluationCase(userId, input);

    return Response.json(evaluationCase, { status: 201 });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}
