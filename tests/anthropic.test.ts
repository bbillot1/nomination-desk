import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnthropicApiError, createMessage } from "../supabase/functions/_shared/anthropic.ts";
import { supervisorPrompt } from "../supabase/functions/_shared/prompts/supervisor.ts";

const tool = {
  name: "delegate_to_specialist",
  description: "Route the run.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: { specialist: { type: "string" } },
    required: ["specialist"],
    additionalProperties: false as const,
  },
};

function installDenoEnv(): void {
  vi.stubGlobal("Deno", {
    env: {
      get(name: string) {
        if (name === "ANTHROPIC_API_KEY") return "test-key-never-sent";
        if (name === "AGENT_MODEL") return "claude-sonnet-5";
        return undefined;
      },
    },
  });
}

function successResponse(): Response {
  return new Response(JSON.stringify({
    id: "msg_test",
    model: "claude-sonnet-5",
    role: "assistant",
    content: [{
      type: "tool_use",
      id: "tool_test",
      name: "delegate_to_specialist",
      input: { specialist: "scheduling" },
    }],
    stop_reason: "tool_use",
    usage: {
      input_tokens: 1_000,
      output_tokens: 100,
      cache_creation_input_tokens: 900,
      cache_read_input_tokens: 0,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Anthropic API wrapper", () => {
  it("uses Sonnet 5 with thinking disabled and no sampling parameters", async () => {
    installDenoEnv();
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => successResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createMessage({
      system: "Route this run.",
      messages: [{ role: "user", content: "A compressor tripped." }],
      tools: [tool],
      maxTokens: 300,
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 300,
      thinking: { type: "disabled" },
      cache_control: { type: "ephemeral" },
      system: [{
        type: "text",
        text: "Route this run.",
        cache_control: { type: "ephemeral" },
      }],
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-key-never-sent");
  });

  it("retries one transient provider response", async () => {
    installDenoEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(successResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await createMessage({
      system: "Route this run.",
      messages: [{ role: "user", content: "Route." }],
      tools: [tool],
    });
    expect(response.id).toBe("msg_test");
    expect(response.request_duration_ms).toBeGreaterThanOrEqual(1_000);
    expect(response.usage).toMatchObject({
      input_tokens: 1_000,
      output_tokens: 100,
      cache_creation_input_tokens: 900,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not expose provider response bodies in errors", async () => {
    installDenoEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("sensitive echoed request", { status: 400 })),
    );

    await expect(createMessage({
      system: "Route this run.",
      messages: [{ role: "user", content: "Route." }],
      tools: [tool],
    })).rejects.toMatchObject({
      status: 400,
      retryable: false,
    } satisfies Partial<AnthropicApiError>);

    try {
      await createMessage({
        system: "Route this run.",
        messages: [{ role: "user", content: "Route." }],
        tools: [tool],
      });
    } catch (error) {
      expect(String(error)).not.toContain("sensitive echoed request");
    }
  });
});

describe("Supervisor routing prompt", () => {
  it("encodes the human approval boundary", () => {
    expect(supervisorPrompt("scada_event")).toContain("scada_event -> scheduling");
    expect(supervisorPrompt("approval_continuation")).toContain(
      "approval_continuation -> exception",
    );
    expect(supervisorPrompt("approval_continuation")).toContain(
      "Never select communications directly",
    );
  });
});
