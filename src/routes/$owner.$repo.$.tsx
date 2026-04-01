import { createFileRoute } from "@tanstack/react-router"
import type { RepoTarget } from "@/types/storage"
import { ResolvedRepoChat } from "@/components/resolved-repo-chat"
import {
  parseRepoPathname,
  parsedPathToRepoTarget,
} from "@/repo/url"

type RepoSplatSearch = {
  q?: string
}

export const Route = createFileRoute("/$owner/$repo/$")({
  validateSearch: (search: RepoSplatSearch) => ({
    q:
      typeof search.q === "string" && search.q.trim().length > 0
        ? search.q
        : undefined,
  }),
  component: RepoChatRoute,
})

function RepoChatRoute() {
  const params = Route.useParams()
  const rawRef = params._splat ?? ""
  const repoTarget: RepoTarget =
    rawRef.startsWith("blob/") ||
    rawRef.startsWith("commit/") ||
    rawRef.startsWith("tree/")
      ? (() => {
          const parsed = parseRepoPathname(
            `/${params.owner}/${params.repo}/${rawRef}`
          )

          return parsed
            ? parsedPathToRepoTarget(parsed)
            : {
                owner: params.owner,
                ref: rawRef,
                repo: params.repo,
              }
        })()
      : {
    owner: params.owner,
    ref: rawRef,
    repo: params.repo,
  }

  return <ResolvedRepoChat repoTarget={repoTarget} />
}
