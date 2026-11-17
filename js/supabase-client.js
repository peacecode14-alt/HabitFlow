// HabitFlow public Supabase client configuration.
// Publishable keys are intended for browser use; protect all exposed tables with RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://yylgyambooemhfpbcnpi.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_EGUvzGUOyRQkMewWIYJHJA_t3OJNUKl";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});
