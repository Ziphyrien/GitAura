import type { UserTurnInput } from "@gitaura/pi/agent/user-turn-input";
import type { ProviderGroupId, ThinkingLevel } from "@gitaura/pi/types/models";

export interface SessionRunner {
  abort(): void | Promise<void>;
  dispose(): void | Promise<void>;
  isBusy(): boolean;
  setModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void>;
  setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void>;
  startTurn(input: string | UserTurnInput): Promise<void>;
  waitForTurn(): Promise<void>;
}
