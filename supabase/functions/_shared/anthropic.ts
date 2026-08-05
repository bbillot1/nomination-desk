import type { ToolDefinition } from "./tools/types.ts";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type MessageBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface MessageParam {
  role: "user" | "assistant";
  content: string | MessageBlock[];
}

export interface AnthropicMessage {
  id: string;
  model: string;
  role: "assistant";
  content: Array<TextBlock | ToolUseBlock>;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  request_duration_ms: number;
}

export class AnthropicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AnthropicApiError";
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`required environment variable is missing: ${name}`);
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function createMessage(options: {
  system: string;
  messages: MessageParam[];
  tools: ToolDefinition[];
  maxTokens?: number;
}): Promise<AnthropicMessage> {
  const model = Deno.env.get("AGENT_MODEL") ?? "claude-sonnet-5";
  const startedAt = Date.now();
  const payload = {
    model,
    max_tokens: options.maxTokens ?? 1_200,
    thinking: { type: "disabled" },
    // Cache the stable tool + system prefix across runs, then automatically move a second
    // breakpoint through the growing tool-use conversation. The 5-minute TTL covers one
    // complete desk workflow without changing model behavior.
    cache_control: { type: "ephemeral" },
    system: [{
      type: "text",
      text: options.system,
      cache_control: { type: "ephemeral" },
    }],
    messages: options.messages,
    tools: options.tools,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": requiredEnv("ANTHROPIC_API_KEY"),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(35_000),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new AnthropicApiError("Anthropic request timed out", 0, true);
      }
      if (attempt === 0) {
        await sleep(1_000);
        continue;
      }
      throw new AnthropicApiError(
        error instanceof Error ? error.message : "Anthropic request failed",
        0,
        true,
      );
    }

    if (response.ok) {
      const message = await response.json() as Omit<AnthropicMessage, "request_duration_ms">;
      const result: AnthropicMessage = {
        ...message,
        request_duration_ms: Date.now() - startedAt,
      };
      // Usage telemetry contains counts and identifiers only—never prompts, tool payloads,
      // credentials, or provider response bodies.
      console.info("anthropic_usage", JSON.stringify({
        message_id: result.id,
        model: result.model,
        request_duration_ms: result.request_duration_ms,
        input_tokens: result.usage?.input_tokens ?? 0,
        output_tokens: result.usage?.output_tokens ?? 0,
        cache_creation_input_tokens: result.usage?.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: result.usage?.cache_read_input_tokens ?? 0,
      }));
      return result;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt === 0) {
      await sleep(1_000);
      continue;
    }

    // Do not include the provider response body: it may echo request content.
    throw new AnthropicApiError(
      `Anthropic API request failed with status ${response.status}`,
      response.status,
      retryable,
    );
  }

  throw new AnthropicApiError("Anthropic API retry loop exhausted", 0, true);
}
