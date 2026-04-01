import { Bash } from "just-bash/browser"
import { GitHubFs } from "@/lib/github"
import type { RepoExecResult, RepoRuntime } from "@/repo/repo-types"
import type { ResolvedRepoSource } from "@/types/storage"

/** Merge persisted session token (legacy) with global PAT from settings. */
export function mergeRepoSourceWithRuntimeToken(
  source: ResolvedRepoSource,
  runtimeToken?: string
): ResolvedRepoSource {
  const rt = runtimeToken?.trim()
  return {
    ...source,
    token: source.token ?? (rt ? rt : undefined),
  }
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function normalizeCwd(next: string | undefined): string {
  if (!next || next === ".") {
    return "/"
  }

  if (next.startsWith("/")) {
    return next
  }

  return `/${next}`
}

export function createRepoRuntime(
  source: ResolvedRepoSource,
  options?: { runtimeToken?: string }
): RepoRuntime {
  const withToken = mergeRepoSourceWithRuntimeToken(source, options?.runtimeToken)

  const fs = new GitHubFs({
    owner: withToken.owner,
    ref: withToken.resolvedRef,
    repo: withToken.repo,
    token: withToken.token,
  })
  const bash = new Bash({
    cwd: "/",
    fs,
  })
  let cwd = "/"

  return {
    bash,
    fs,
    getCwd() {
      return cwd
    },
    getWarnings() {
      return fs.warnings.map((warning) => warning.message)
    },
    refresh() {
      fs.refresh()
    },
    setCwd(next) {
      cwd = normalizeCwd(next)
    },
    source,
  }
}

export async function execInRepoShell(
  runtime: RepoRuntime,
  command: string,
  signal?: AbortSignal
): Promise<RepoExecResult> {
  const cwd = runtime.getCwd()
  const script =
    cwd === "/" ? command : `cd ${shellEscape(cwd)}\n${command}`
  const result = await runtime.bash.exec(script, {
    cwd,
    signal,
  })
  const nextCwd = result.env.PWD

  runtime.setCwd(nextCwd)

  return {
    ...result,
    cwd: runtime.getCwd(),
  }
}
