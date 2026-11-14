// Supabase client for auth (password + Google OAuth). The anon key is public
// by design; the service key stays in the backend only.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

if (!url || !anonKey) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — auth and server data are disabled. See .env.example.",
  );
}

export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "placeholder", {
  auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
});

export async function sessionOrNull() {
  const { data } = await supabase.auth.getSession();
  return data.session; // null in guest mode → callers stay local (SKILL.md §8)
}
