"use client"

import * as React from "react"
import { Chat } from "@/components/chat"
import { handleGithubError } from "@/repo/github-fetch"
import { resolveRepoTarget } from "@/repo/ref-resolver"
import type { RepoTarget, ResolvedRepoSource } from "@/types/storage"

type ResolutionState =
  | { kind: "error" }
  | { kind: "loading" }
  | { kind: "ready"; repoSource: ResolvedRepoSource }

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export function ResolvedRepoChat({
  repoTarget,
}: {
  repoTarget: RepoTarget
}) {
  const [state, setState] = React.useState<ResolutionState>({
    kind: "loading",
  })

  React.useEffect(() => {
    let cancelled = false

    setState({ kind: "loading" })

    void resolveRepoTarget(repoTarget)
      .then((repoSource) => {
        if (!cancelled) {
          setState({ kind: "ready", repoSource })
        }
      })
      .catch((error) => {
        void handleGithubError(error)

        if (!cancelled) {
          setState({ kind: "error" })
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    repoTarget.owner,
    repoTarget.ref,
    repoTarget.refPathTail,
    repoTarget.repo,
    repoTarget.token,
  ])

  if (state.kind === "loading") {
    return <LoadingState label="Loading repository..." />
  }

  if (state.kind === "error") {
    return <LoadingState label="Repository unavailable." />
  }

  return <Chat repoSource={state.repoSource} />
}
