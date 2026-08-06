import { GraphPageClient } from "./page-client";
import { requireGraphUser } from "@/lib/graph/auth";
import { redirect } from "next/navigation";

export default async function GraphPage() {
  try {
    await requireGraphUser();
  } catch {
    redirect("/auth/login");
  }

  return <GraphPageClient />;
}
