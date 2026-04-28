import type { UserTurnInput } from "@webaura/pi/agent/user-turn-input";
import type { ProviderGroupId, ThinkingLevel } from "@webaura/pi/types/models";

export interface SessionRunner {
  abort(): void | Promise<void>;
  dispose(): void | Promise<void>;
  isBusy(): boolean;
  setModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void>;
  setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void>;
  startTurn(input: string | UserTurnInput): Promise<void>;
  waitForTurn(): Promise<void>;
}
