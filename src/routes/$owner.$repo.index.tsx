import { createFileRoute } from "@tanstack/react-router"
import type { RepoTarget } from "@/types/storage"
import { ResolvedRepoChat } from "@/components/resolved-repo-chat"

type RepoSearch = {
  q?: string
}

export const Route = createFileRoute("/$owner/$repo/")({
  validateSearch: (search: RepoSearch) => ({
    q:
      typeof search.q === "string" && search.q.trim().length > 0
        ? search.q
        : undefined,
  }),
  component: RepoChatRoute,
})

function RepoChatRoute() {
  const params = Route.useParams()
  const repoTarget: RepoTarget = {
    owner: params.owner,
    repo: params.repo,
  }

  return <ResolvedRepoChat repoTarget={repoTarget} />
}
