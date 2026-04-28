import type { Remote } from "comlink";
import { createRuntimeWorkerClient } from "@webaura/pi/agent/runtime-worker-client-shared";

declare const ComlinkWorker: new <TModule>(
  scriptURL: URL,
  options?: WorkerOptions,
) => Remote<TModule>;

function createRuntimeWorker() {
  return new ComlinkWorker<typeof import("./runtime-worker")>(
    new URL("./runtime-worker", import.meta.url),
    {
      name: "webaura-runtime-worker",
      type: "module",
    },
  );
}

const client = createRuntimeWorkerClient(createRuntimeWorker);

export const { getRuntimeWorker, getRuntimeWorkerIfAvailable } = client;
