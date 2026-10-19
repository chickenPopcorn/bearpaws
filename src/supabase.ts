import { createClient, type User } from "@supabase/supabase-js";

// Both values are public. The publishable key only allows what each table's
// and bucket's row-level security policies allow the signed-in user.
const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const key: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** The account service, or null when this build was made without its settings. */
export const supabase =
  url && key ? createClient(url, key, { auth: { flowType: "pkce" } }) : null;

/** The first name on the signed-in Google account, or "" without one. */
export function firstName(user: User | null | undefined): string {
  const profile = user?.user_metadata ?? {};
  const name = [profile.given_name, profile.full_name, profile.name].find(
    (value): value is string => typeof value === "string" && !!value.trim(),
  );
  return name ? name.trim().split(/\s+/)[0] : "";
}

/** Leave for Google's sign-in page; it returns to this page signed in. */
export function signInWithGoogle() {
  if (!supabase) throw new Error("Sign-in is not set up for this site.");
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}
