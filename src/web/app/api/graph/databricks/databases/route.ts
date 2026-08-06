import { requireGraphUser } from "@/lib/graph/auth";
import { listDatabricksDatabases } from "@/lib/graph/databricks";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Databricks error";
}

export async function GET() {
  try {
    await requireGraphUser();
    const databases = await listDatabricksDatabases();
    return Response.json({ databases });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
