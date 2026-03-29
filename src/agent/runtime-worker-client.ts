import * as Comlink from "comlink"
import type { RuntimeWorkerEvents } from "@/agent/runtime-worker-types"

let workerApi:
  | Comlink.Remote<typeof import("./runtime-worker")>
  | undefined

export function getRuntimeWorker() {
  workerApi ??= new ComlinkWorker<typeof import("./runtime-worker")>(
    new URL("./runtime-worker", import.meta.url),
    {
      name: "gitinspect-runtime-worker",
      type: "module",
    }
  )

  return workerApi
}

export function createRuntimeWorkerEvents(
  sink: RuntimeWorkerEvents
): RuntimeWorkerEvents {
  return Comlink.proxy(sink)
}
