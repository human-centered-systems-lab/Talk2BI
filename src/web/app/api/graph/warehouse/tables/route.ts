import { requireGraphUser } from "@/lib/graph/auth";
import { getWarehouseProvider } from "@/lib/graph/warehouse";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown warehouse error";
}

export async function GET(req: Request) {
  try {
    await requireGraphUser();
    const { searchParams } = new URL(req.url);
    const database = searchParams.get("database");

    if (!database) {
      return Response.json({ error: "Missing database" }, { status: 400 });
    }

    const provider = getWarehouseProvider(searchParams.get("dialect"));
    const tables = await provider.listTables(database);
    return Response.json({ tables });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === "Unauthorized" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
