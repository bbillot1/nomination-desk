import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | undefined;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`required environment variable is missing: ${name}`);
  return value;
}

function serviceKey(): string {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    const parsed = JSON.parse(modern) as Record<string, unknown>;
    const key = parsed.default;
    if (typeof key === "string" && key !== "") return key;
  }

  // Legacy hosted projects expose this automatically. It remains a fallback only.
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/** Service-role client for Edge Functions only. Never import this module into browser code. */
export function getServiceClient(): SupabaseClient {
  serviceClient ??= createClient(requiredEnv("SUPABASE_URL"), serviceKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return serviceClient;
}
