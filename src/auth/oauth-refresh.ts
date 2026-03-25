import { refreshAnthropic } from "@/auth/providers/anthropic"
import { refreshGitHubCopilot } from "@/auth/providers/github-copilot"
import { refreshGeminiCli } from "@/auth/providers/google-gemini-cli"
import { refreshOpenAICodex } from "@/auth/providers/openai-codex"
import type { OAuthCredentials } from "@/auth/oauth-types"
import type { ProxyRequestOptions } from "@/auth/oauth-utils"

export async function oauthRefresh(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions
): Promise<OAuthCredentials> {
  switch (credentials.providerId) {
    case "anthropic":
      return await refreshAnthropic(credentials, options)
    case "github-copilot":
      return await refreshGitHubCopilot(credentials)
    case "google-gemini-cli":
      return await refreshGeminiCli(credentials)
    case "openai-codex":
      return await refreshOpenAICodex(credentials)
  }
}
