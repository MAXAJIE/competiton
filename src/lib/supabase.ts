// Supabase client for auth (password + Google OAuth). The anon key is public
// by design; the service key stays in the backend only.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

/** False when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were not baked into
 *  the build. Callers must gate sign-in on this: with no config there is no
 *  correct default, and a guessed URL (localhost:54321 = the Supabase CLI port)
 *  sent users to a connection-refused page instead of Google. */
export const AUTH_CONFIGURED = Boolean(url && anonKey);

if (!AUTH_CONFIGURED) {
  console.error(
    "Auth is disabled: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set in this build. " +
      "They are baked in at build time — set them in the deploy platform's build settings (or .env.local for dev).",
  );
}

export const supabase = createClient(url ?? "http://auth-not-configured.invalid", anonKey ?? "placeholder", {
  auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
});

export async function sessionOrNull() {
  const { data } = await supabase.auth.getSession();
  return data.session; // null in guest mode → callers stay local (SKILL.md §8)
}
