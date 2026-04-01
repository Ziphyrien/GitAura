import { GitHubFsError } from "@/lib/github"

export function warningMessageToError(message: string): GitHubFsError {
  return new GitHubFsError({
    code: "ENOTSUP",
    isRetryable: false,
    kind: "unsupported",
    message,
    path: "/",
  })
}
