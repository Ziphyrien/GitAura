import { deleteSetting, getSetting, setSetting } from "@webaura/db";

const GITHUB_PAT_KEY = "github.pat";

/** Default GitHub token generator for optional future GitHub modules. */
export const GITHUB_CREATE_PAT_URL =
  "https://github.com/settings/personal-access-tokens/new?name=WebAura&description=Optional%20token%20for%20WebAura%20GitHub%20modules&expires_in=none";

export type GithubTokenValidation = { ok: true; login: string } | { ok: false; message: string };

/** Confirms the token works without enabling any GitHub module behavior. */
export async function validateGithubPersonalAccessToken(
  token: string,
): Promise<GithubTokenValidation> {
  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, message: "Token is empty" };
  }

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${trimmed}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (response.status === 401) {
      return { ok: false, message: "Invalid or expired token" };
    }

    if (!response.ok) {
      return { ok: false, message: "Could not verify token with GitHub" };
    }

    const data = (await response.json()) as { login?: string };
    return { ok: true, login: data.login ?? "user" };
  } catch {
    return { ok: false, message: "Could not reach GitHub — check your connection" };
  }
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function getGithubPersonalAccessToken(): Promise<string | undefined> {
  const value = await getSetting(GITHUB_PAT_KEY);
  return typeof value === "string" ? trimToUndefined(value) : undefined;
}

export async function setGithubPersonalAccessToken(token: string | undefined): Promise<void> {
  const normalized = trimToUndefined(token);

  if (!normalized) {
    await deleteSetting(GITHUB_PAT_KEY);
    return;
  }

  await setSetting(GITHUB_PAT_KEY, normalized);
}
