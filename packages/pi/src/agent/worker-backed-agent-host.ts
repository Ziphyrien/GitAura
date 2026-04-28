import { BusyRuntimeError } from "@webaura/pi/agent/runtime-command-errors";
import { getCurrentTabId } from "@webaura/pi/agent/tab-id";
import { getRuntimeWorker } from "@webaura/pi/agent/runtime-worker-client";
import type { SessionRunner } from "@webaura/pi/agent/session-runner";
import type { TurnEnvelope } from "@webaura/pi/agent/turn-event-store";
import { createId } from "@webaura/pi/lib/ids";
import { clampThinkingLevel } from "@webaura/pi/agent/thinking-levels";
import {
  createUserMessageFromTurnInput,
  hasUserTurnInputContent,
  type UserTurnInput,
} from "@webaura/pi/agent/user-turn-input";
import { getCanonicalProvider, getModel } from "@webaura/pi/models/catalog";
import type { SessionData } from "@webaura/db";
import type { ProviderGroupId, ThinkingLevel } from "@webaura/pi/types/models";

type HostState = "idle" | "starting" | "running" | "disposing" | "disposed";

async function createTurn(input: string | UserTurnInput): Promise<TurnEnvelope | undefined> {
  const userMessage = await createUserMessageFromTurnInput({
    id: createId(),
    input,
    timestamp: Date.now(),
  });

  if (!userMessage) {
    return undefined;
  }

  return {
    turnId: createId(),
    userMessage,
  };
}

export class WorkerBackedAgentHost implements SessionRunner {
  private readonly worker = getRuntimeWorker();
  private runningTurn?: Promise<void>;
  private disposePromise?: Promise<void>;
  private state: HostState = "idle";
  private startSequence = 0;

  constructor(private session: SessionData) {}

  isBusy(): boolean {
    return this.state === "starting" || this.state === "running" || this.runningTurn !== undefined;
  }

  async startTurn(input: string | UserTurnInput): Promise<void> {
    if (
      !hasUserTurnInputContent(input) ||
      this.state === "disposing" ||
      this.state === "disposed"
    ) {
      return;
    }

    if (this.state !== "idle") {
      throw new BusyRuntimeError(this.session.id);
    }

    this.state = "starting";
    const startSequence = ++this.startSequence;
    let waitForTurnPromise: Promise<void> | undefined;

    try {
      const turn = await createTurn(input);

      if (!turn) {
        return;
      }

      await this.worker.startTurn({
        ownerTabId: getCurrentTabId(),
        session: this.session,
        turn,
      });

      waitForTurnPromise = this.worker
        .waitForTurn(this.session.id)
        .then(() => undefined)
        .finally(() => {
          if (this.runningTurn === waitForTurnPromise) {
            this.runningTurn = undefined;
          }

          if (this.state === "running") {
            this.state = "idle";
          }
        });
      this.runningTurn = waitForTurnPromise;

      if (!this.isStartActive(startSequence)) {
        if (this.shouldAbortAfterCancelledStart()) {
          await this.worker.abortTurn(this.session.id);
        }

        await waitForTurnPromise.catch(() => undefined);
        return;
      }

      this.state = "running";
    } finally {
      if (this.state === "starting" && this.startSequence === startSequence) {
        this.state = "idle";
      }
    }
  }

  async waitForTurn(): Promise<void> {
    await this.runningTurn;
  }

  async abort(): Promise<void> {
    if (this.state !== "running") {
      return;
    }

    await this.worker.abortTurn(this.session.id);
  }

  async setModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void> {
    if (this.state === "disposing" || this.state === "disposed") {
      return;
    }

    await this.worker.setModelSelection({
      modelId,
      providerGroup,
      sessionId: this.session.id,
    });
    const provider = getCanonicalProvider(providerGroup);
    this.session = {
      ...this.session,
      model: modelId,
      provider,
      providerGroup,
      thinkingLevel: clampThinkingLevel(this.session.thinkingLevel, getModel(provider, modelId)),
    };
  }

  async setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void> {
    if (this.state === "disposing" || this.state === "disposed") {
      return;
    }

    await this.worker.setThinkingLevel({
      sessionId: this.session.id,
      thinkingLevel,
    });
    this.session = {
      ...this.session,
      thinkingLevel,
    };
  }

  async dispose(): Promise<void> {
    if (this.state === "disposed") {
      return;
    }

    if (this.disposePromise) {
      return await this.disposePromise;
    }

    this.state = "disposing";
    this.disposePromise = (async () => {
      await this.worker.disposeSession(this.session.id);
      await this.runningTurn?.catch(() => undefined);
      this.runningTurn = undefined;
      this.state = "disposed";
    })();

    return await this.disposePromise;
  }

  private isStartActive(startSequence: number): boolean {
    return this.state === "starting" && this.startSequence === startSequence;
  }

  private shouldAbortAfterCancelledStart(): boolean {
    return this.state !== "disposing" && this.state !== "disposed";
  }
}
