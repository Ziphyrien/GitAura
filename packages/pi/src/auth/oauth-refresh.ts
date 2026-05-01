import { refreshGitHubCopilot } from "@webaura/pi/auth/providers/github-copilot";
import { refreshOpenAICodex } from "@webaura/pi/auth/providers/openai-codex";
import type { OAuthCredentials } from "@webaura/pi/auth/oauth-types";
import type { ProxyRequestOptions } from "@webaura/pi/auth/oauth-utils";

export async function oauthRefresh(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  switch (credentials.providerId) {
    case "github-copilot":
      return await refreshGitHubCopilot(credentials, options);
    case "openai-codex":
      return await refreshOpenAICodex(credentials, options);
  }
}
