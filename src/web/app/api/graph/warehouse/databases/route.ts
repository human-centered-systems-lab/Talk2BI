import { requireGraphUser } from "@/lib/graph/auth";
import { getWarehouseProvider } from "@/lib/graph/warehouse";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown warehouse error";
}

export async function GET(req: Request) {
  try {
    await requireGraphUser();
    const { searchParams } = new URL(req.url);
    const provider = getWarehouseProvider(searchParams.get("dialect"));
    const databases = await provider.listDatabases();
    return Response.json({ databases });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
