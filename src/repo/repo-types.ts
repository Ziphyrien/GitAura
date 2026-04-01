import type { Bash, BashExecResult } from "just-bash/browser"
import type { GitHubFs } from "@/lib/github"
import type { ResolvedRepoSource } from "@/types/storage"

export interface RepoRuntime {
  bash: Bash
  fs: GitHubFs
  getCwd(): string
  getWarnings(): string[]
  refresh(): void
  setCwd(next: string): void
  source: ResolvedRepoSource
}

export interface RepoExecResult extends BashExecResult {
  cwd: string
}
