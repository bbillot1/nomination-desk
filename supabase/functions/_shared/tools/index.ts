import {
  definitions as ebbDefinitions,
  handlers as ebbHandlers,
} from "./ebb.ts";
import {
  definitions as engineDefinitions,
  handlers as engineHandlers,
} from "./engine-tools.ts";
import {
  definitions as historianDefinitions,
  handlers as historianHandlers,
} from "./historian.ts";
import {
  definitions as quorumDefinitions,
  handlers as quorumHandlers,
} from "./quorum.ts";
import {
  definitions as stagingDefinitions,
  handlers as stagingHandlers,
} from "./staging-tools.ts";
import {
  definitions as workflowDefinitions,
  handlers as workflowHandlers,
} from "./workflow-tools.ts";
import {
  ToolFailure,
  type ToolContext,
  type ToolDefinition,
  type ToolHandler,
  type ToolResult,
} from "./types.ts";

export * from "./database.ts";
export * from "./types.ts";

export const definitions: ToolDefinition[] = [
  ...historianDefinitions,
  ...ebbDefinitions,
  ...quorumDefinitions,
  ...engineDefinitions,
  ...stagingDefinitions,
  ...workflowDefinitions,
];

export const handlers: Record<string, ToolHandler> = {
  ...historianHandlers,
  ...ebbHandlers,
  ...quorumHandlers,
  ...engineHandlers,
  ...stagingHandlers,
  ...workflowHandlers,
};

function assertRegistryIntegrity(): void {
  const names = definitions.map((definition) => definition.name);
  const unique = new Set(names);
  if (unique.size !== names.length) {
    throw new Error("duplicate tool definition name");
  }
  for (const name of names) {
    if (handlers[name] === undefined) {
      throw new Error(`tool definition has no handler: ${name}`);
    }
  }
  for (const name of Object.keys(handlers)) {
    if (!unique.has(name)) {
      throw new Error(`tool handler has no definition: ${name}`);
    }
  }
}

assertRegistryIntegrity();

/** Return only the definitions a specialist is allowed to use. */
export function selectDefinitions(names: readonly string[]): ToolDefinition[] {
  const requested = new Set(names);
  const selected = definitions.filter((definition) => requested.has(definition.name));
  const missing = names.filter((name) => !selected.some((definition) => definition.name === name));
  if (missing.length > 0) {
    throw new Error(`unknown tool definitions: ${missing.join(", ")}`);
  }
  return selected;
}

/**
 * The sole model-facing dispatch boundary.
 *
 * Handlers may throw internally, but no exception reaches the model. Failures are converted to
 * concise structured results so the agent can reason about them without receiving stack traces
 * or implementation details.
 */
export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const handler = handlers[name];
  if (handler === undefined) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: `tool is not registered: ${name}`,
        retryable: false,
      },
    };
  }

  try {
    return await handler(input, context);
  } catch (error) {
    if (error instanceof ToolFailure) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "INTERNAL_TOOL_ERROR",
        message: "The tool failed unexpectedly. No action was taken.",
        retryable: false,
      },
    };
  }
}
