import type { RuntimePhase, SessionRuntimeRow, SessionRuntimeStatus } from "./types";

export function derivePhaseFromStatus(status: SessionRuntimeStatus | undefined): RuntimePhase {
  switch (status) {
    case "streaming":
      return "running";
    case "interrupted":
    case "aborted":
    case "error":
      return "interrupted";
    default:
      return "idle";
  }
}

export function deriveStatusFromPhase(
  phase: RuntimePhase,
  current: SessionRuntimeRow | undefined,
): SessionRuntimeStatus {
  if (phase === "running") {
    return "streaming";
  }

  if (phase === "interrupted") {
    const currentStatus = current?.status;
    return currentStatus === "aborted" || currentStatus === "error" ? currentStatus : "interrupted";
  }

  return "completed";
}

export function normalizeSessionRuntime(
  sessionId: string,
  runtime: SessionRuntimeRow | undefined,
): SessionRuntimeRow | undefined {
  if (!runtime) {
    return undefined;
  }

  const phase = runtime.phase ?? derivePhaseFromStatus(runtime.status);

  return {
    ...runtime,
    phase,
    sessionId,
    status: runtime.status ?? deriveStatusFromPhase(phase, runtime),
  };
}
