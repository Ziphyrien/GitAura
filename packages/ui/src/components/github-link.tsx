import { Icons } from "@webaura/ui/components/icons";
import { Button } from "@webaura/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@webaura/ui/components/tooltip";
import { Skeleton } from "@webaura/ui/components/skeleton";
import {
  GITHUB_APP_REPO,
  useGitHubRepoStargazers,
} from "@webaura/pi/hooks/use-github-repo-stargazers";
import { formatGitHubStarCount } from "@webaura/pi/lib/format-github-stars";

export function GitHubLink() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild className="h-8 gap-1.5 px-2 shadow-none" size="sm" variant="ghost">
          <a
            aria-label="Open GitHub Repo"
            href={`https://github.com/${GITHUB_APP_REPO.owner}/${GITHUB_APP_REPO.repo}`}
            rel="noreferrer"
            target="_blank"
          >
            <Icons.gitHub className="text-foreground" />
            <StarsCount />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>Open GitHub Repo</TooltipContent>
    </Tooltip>
  );
}

function StarsCount() {
  const { owner, repo } = GITHUB_APP_REPO;
  const state = useGitHubRepoStargazers(owner, repo);

  if (state.status === "loading") {
    return <Skeleton className="h-4 w-8" />;
  }

  if (state.status === "error") {
    return <span className="w-fit text-xs text-muted-foreground tabular-nums">—</span>;
  }

  return (
    <span className="w-fit text-xs text-muted-foreground tabular-nums">
      {formatGitHubStarCount(state.count)}
    </span>
  );
}
