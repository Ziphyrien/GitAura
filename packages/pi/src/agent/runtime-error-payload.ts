export type RuntimeErrorPayload = {
  message: string;
  name: string;
  type: "error";
};

export function serializeRuntimeError(error: unknown): RuntimeErrorPayload {
  const normalized = error instanceof Error ? error : new Error(String(error));

  return {
    message: normalized.message,
    name: normalized.name,
    type: "error",
  };
}

export function deserializeRuntimeError(payload: RuntimeErrorPayload): Error {
  const error = new Error(payload.message);
  error.name = payload.name;
  return error;
}
