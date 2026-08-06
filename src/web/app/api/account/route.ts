import { createClient } from "@/lib/supabase/server";

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase.rpc("delete_own_account");
  if (error) {
    return Response.json(
      { error: "Could not delete your account." },
      { status: 500 },
    );
  }

  return Response.json({ success: true });
}
