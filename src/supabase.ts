import { createClient } from "@supabase/supabase-js";

// Both values are public. The publishable key only allows what each table's
// and bucket's row-level security policies allow the signed-in user.
const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const key: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** The account service, or null when this build was made without its settings. */
export const supabase =
  url && key ? createClient(url, key, { auth: { flowType: "pkce" } }) : null;

/** Leave for Google's sign-in page; it returns to this page signed in. */
export function signInWithGoogle() {
  if (!supabase) throw new Error("Sign-in is not set up for this site.");
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}
