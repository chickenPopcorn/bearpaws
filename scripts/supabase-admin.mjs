// The Supabase project, as the scripts that read and change its Storage use
// it: with the project's secret key, which row-level security does not limit.
// The key comes from SUPABASE_SECRET_KEY, or is looked up with a Supabase
// account token in MUSIC_API_KEY. Neither ever reaches the app.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";

const env = { ...loadEnv("", process.cwd(), "VITE_"), ...process.env };

/** A Supabase client with the project's secret key. */
export async function adminClient() {
  const url = env.VITE_SUPABASE_URL;
  if (!url)
    throw new Error("Set VITE_SUPABASE_URL in .env.local (see README).");
  return createClient(url, await secretKey(url), {
    auth: { persistSession: false },
  });
}

async function secretKey(url) {
  if (env.SUPABASE_SECRET_KEY) return env.SUPABASE_SECRET_KEY;
  if (!env.MUSIC_API_KEY)
    throw new Error("Set SUPABASE_SECRET_KEY or MUSIC_API_KEY.");
  const ref = new URL(url).hostname.split(".")[0];
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${env.MUSIC_API_KEY}` } },
  );
  if (!response.ok)
    throw new Error(`Supabase account API: HTTP ${response.status}`);
  const key = (await response.json()).find((k) => k.type === "secret");
  if (!key) throw new Error("This project has no secret API key.");
  return key.api_key;
}
