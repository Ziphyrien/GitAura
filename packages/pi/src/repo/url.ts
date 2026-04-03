import type { ResolvedRepoSource } from "@gitinspect/db/storage-types";

function encodePathSegments(path: string | undefined): string {
  return (
    path
      ?.trim()
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/") ?? ""
  );
}

function buildRepoPathname(owner: string, repo: string, ref?: string): string {
  const encodedOwner = encodeURIComponent(owner.trim());
  const encodedRepo = encodeURIComponent(repo.trim());
  const encodedRef = encodePathSegments(ref);

  return encodedRef
    ? `/${encodedOwner}/${encodedRepo}/${encodedRef}`
    : `/${encodedOwner}/${encodedRepo}`;
}

export function repoSourceToPath(
  source: Pick<ResolvedRepoSource, "owner" | "repo" | "ref" | "refOrigin">,
): string {
  return buildRepoPathname(
    source.owner,
    source.repo,
    source.refOrigin === "default" ? undefined : source.ref,
  );
}

export function githubRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${encodeURIComponent(owner.trim())}/${encodeURIComponent(repo.trim())}`;
}

export function githubRepoPathUrl(owner: string, repo: string, path?: string): string {
  const encodedPath = encodePathSegments(path);
  const baseUrl = githubRepoUrl(owner, repo);
  return encodedPath ? `${baseUrl}/${encodedPath}` : baseUrl;
}

export function repoSourceToGitHubUrl(
  source: Pick<ResolvedRepoSource, "owner" | "repo" | "ref" | "refOrigin" | "resolvedRef">,
): string {
  if (source.refOrigin === "default") {
    return githubRepoUrl(source.owner, source.repo);
  }

  if (source.resolvedRef.kind === "commit") {
    return githubRepoPathUrl(source.owner, source.repo, `commit/${source.resolvedRef.sha}`);
  }

  return githubRepoPathUrl(source.owner, source.repo, `tree/${source.ref}`);
}

export function githubOwnerAvatarUrl(owner: string): string {
  return `https://github.com/${encodeURIComponent(owner)}.png`;
}
