import type { ResolvedRepoSource } from "@webaura/db";
import { createReadTool } from "@webaura/pi/tools/read";
import { toAgentTool, toProviderToolDefinition } from "@webaura/pi/tools/types";

export function createRepoTools(
  source: ResolvedRepoSource,
  options?: {
    onRepoError?: (error: unknown) => void | Promise<void>;
  },
) {
  const read = createReadTool(source, options?.onRepoError);
  const definitions = [read];

  return {
    agentTools: [toAgentTool(read)],
    definitions,
    providerTools: [toProviderToolDefinition(read)],
  };
}
