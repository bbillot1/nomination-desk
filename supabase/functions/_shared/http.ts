export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

export function optionsResponse(): Response {
  return new Response("ok", { headers: corsHeaders });
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "expected application/json");
  }
  const value = await request.json();
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new HttpError(400, "request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Reference-scope caller check.
 *
 * The phase explicitly has no user authentication, but anonymous internet callers still must
 * know this project's browser-safe key. This is not authorization; production replaces it
 * with user sessions and role checks.
 */
export function requireProjectCaller(request: Request): void {
  const presentedApiKey = request.headers.get("apikey");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const accepted = new Set<string>();

  const modern = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (modern) {
    const parsed = JSON.parse(modern) as Record<string, unknown>;
    for (const value of Object.values(parsed)) {
      if (typeof value === "string") accepted.add(value);
    }
  }
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) accepted.add(legacy);

  if (
    accepted.size === 0 ||
    (![presentedApiKey, bearer].some((value) =>
      typeof value === "string" && accepted.has(value)
    ))
  ) {
    throw new HttpError(401, "unauthorized");
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return jsonResponse({ error: error.message }, error.status);
  console.error("Edge Function error:", error instanceof Error ? error.message : "unknown error");
  // Do not echo provider/DB internals to the browser.
  return jsonResponse({ error: "internal error" }, 500);
}
