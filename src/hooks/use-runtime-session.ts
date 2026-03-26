import * as React from "react"
import { runtimeClient } from "@/agent/runtime-client"

export function getRuntimeActionErrorMessage(error: Error | undefined): string {
  if (!error) {
    return "Runtime request failed"
  }
  switch (error.message) {
    case "busy":
      return "This session is already streaming."
    case "missing-session":
      return "This session could not be loaded from local storage."
    default:
      return error.message
  }
}

export function useRuntimeSession(sessionId: string | undefined) {
  const [actionError, setActionError] = React.useState<string | undefined>(undefined)

  const runMutation = React.useEffectEvent(
    async (action: (currentSessionId: string) => Promise<void>) => {
      if (!sessionId) {
        return
      }

      setActionError(undefined)

      try {
        await action(sessionId)
      } catch (error) {
        setActionError(
          getRuntimeActionErrorMessage(error instanceof Error ? error : undefined)
        )
      }
    }
  )

  const send = React.useEffectEvent(async (content: string) => {
    await runMutation(async (currentSessionId) => {
      const result = await runtimeClient.send(currentSessionId, content)

      if (!result.ok) {
        throw new Error(result.error ?? "missing-session")
      }
    })
  })

  const abort = React.useEffectEvent(async () => {
    if (!sessionId) {
      return
    }

    setActionError(undefined)
    await runtimeClient.abort(sessionId)
  })

  const setModelSelection = React.useEffectEvent(
    async (
      providerGroup: Parameters<typeof runtimeClient.setModelSelection>[1],
      model: string
    ) => {
      await runMutation(async (currentSessionId) => {
        const result = await runtimeClient.setModelSelection(
          currentSessionId,
          providerGroup,
          model
        )

        if (!result.ok) {
          throw new Error(result.error ?? "missing-session")
        }
      })
    }
  )

  const setRepoSource = React.useEffectEvent(
    async (repoSource?: Parameters<typeof runtimeClient.setRepoSource>[1]) => {
      await runMutation(async (currentSessionId) => {
        const result = await runtimeClient.setRepoSource(
          currentSessionId,
          repoSource
        )

        if (!result.ok) {
          throw new Error(result.error ?? "missing-session")
        }
      })
    }
  )

  const setThinkingLevel = React.useEffectEvent(
    async (
      thinkingLevel: Parameters<typeof runtimeClient.setThinkingLevel>[1]
    ) => {
      await runMutation(async (currentSessionId) => {
        const result = await runtimeClient.setThinkingLevel(
          currentSessionId,
          thinkingLevel
        )

        if (!result.ok) {
          throw new Error(result.error ?? "missing-session")
        }
      })
    }
  )

  return {
    abort,
    error: actionError,
    send,
    setModelSelection,
    setRepoSource,
    setThinkingLevel,
  }
}
