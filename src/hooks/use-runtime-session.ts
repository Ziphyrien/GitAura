import * as React from "react"
import { runtimeClient } from "@/agent/runtime-client"

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
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

  const send = React.useEffectEvent(async (content: string) => {
    if (!sessionId) {
      return
    }

    setActionError(undefined)

    try {
      const result = await runtimeClient.send(sessionId, content)

      if (!result.ok) {
        throw new Error(result.error ?? "missing-session")
      }
    } catch (error) {
      setActionError(getErrorMessage(error))
    }
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
      if (!sessionId) {
        return
      }

      setActionError(undefined)

      try {
        const result = await runtimeClient.setModelSelection(
          sessionId,
          providerGroup,
          model
        )

        if (!result.ok) {
          throw new Error(result.error ?? "missing-session")
        }
      } catch (error) {
        setActionError(getErrorMessage(error))
      }
    }
  )

  const setRepoSource = React.useEffectEvent(
    async (repoSource?: Parameters<typeof runtimeClient.setRepoSource>[1]) => {
      if (!sessionId) {
        return
      }

      setActionError(undefined)

      try {
        const result = await runtimeClient.setRepoSource(sessionId, repoSource)

        if (!result.ok) {
          throw new Error(result.error ?? "missing-session")
        }
      } catch (error) {
        setActionError(getErrorMessage(error))
      }
    }
  )

  const setThinkingLevel = React.useEffectEvent(
    async (
      thinkingLevel: Parameters<typeof runtimeClient.setThinkingLevel>[1]
    ) => {
      if (!sessionId) {
        return
      }

      setActionError(undefined)

      try {
        const result = await runtimeClient.setThinkingLevel(
          sessionId,
          thinkingLevel
        )

        if (!result.ok) {
          throw new Error(result.error ?? "missing-session")
        }
      } catch (error) {
        setActionError(getErrorMessage(error))
      }
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
