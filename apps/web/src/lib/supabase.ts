import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    // Installed to a home screen and used one-handed — signing in repeatedly
    // would be the single biggest source of friction in the whole app.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
