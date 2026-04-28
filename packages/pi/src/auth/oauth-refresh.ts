import { refreshAnthropic } from "@gitaura/pi/auth/providers/anthropic";
import { refreshGitHubCopilot } from "@gitaura/pi/auth/providers/github-copilot";
import { refreshGeminiCli } from "@gitaura/pi/auth/providers/google-gemini-cli";
import { refreshOpenAICodex } from "@gitaura/pi/auth/providers/openai-codex";
import type { OAuthCredentials } from "@gitaura/pi/auth/oauth-types";
import type { ProxyRequestOptions } from "@gitaura/pi/auth/oauth-utils";

export async function oauthRefresh(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  switch (credentials.providerId) {
    case "anthropic":
      return await refreshAnthropic(credentials, options);
    case "github-copilot":
      return await refreshGitHubCopilot(credentials, options);
    case "google-gemini-cli":
      return await refreshGeminiCli(credentials, options);
    case "openai-codex":
      return await refreshOpenAICodex(credentials, options);
  }
}
