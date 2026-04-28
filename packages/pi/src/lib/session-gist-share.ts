import { getGithubPersonalAccessToken } from "@webaura/pi/repo/github-token";
import { messagesToMarkdown } from "@webaura/pi/lib/copy-session-markdown";
import type { SessionData } from "@webaura/db";
import type { DisplayChatMessage } from "@webaura/pi/types/chat";

const GITHUB_GISTS_API_URL = "https://api.github.com/gists";

export type SessionGistShareResult = {
  id: string;
  url: string;
};

export type SessionGistShareErrorCode =
  | "github_error"
  | "insufficient_scope"
  | "invalid_token"
  | "missing_token"
  | "network_error";

export class SessionGistShareError extends Error {
  code: SessionGistShareErrorCode;
  status?: number;

  constructor(code: SessionGistShareErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.name = "SessionGistShareError";
    this.status = status;
  }
}

type SessionGistShareInput = {
  messages: readonly DisplayChatMessage[];
  session: SessionData;
  sourceUrl?: string;
  token?: string;
};

type SessionGistShareMetadata = {
  app: "WebAura";
  exportedAt: string;
  format: "webaura-session-gist";
  session: {
    createdAt: string;
    messageCount: number;
    model: string;
    provider: string;
    providerGroup?: string;
    repoSource?: SessionData["repoSource"];
    sourceUrl?: string;
    thinkingLevel: string;
    title: string;
    updatedAt: string;
  };
  version: 1;
};

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeFileStem(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized || "chat";
}

function buildFileStem(session: SessionData): string {
  if (session.repoSource) {
    return sanitizeFileStem(
      `${session.repoSource.owner}-${session.repoSource.repo}-${session.repoSource.ref}`,
    );
  }

  if (session.title && session.title !== "New chat") {
    return sanitizeFileStem(session.title);
  }

  return "chat";
}

function buildGistDescription(session: SessionData): string {
  if (session.repoSource) {
    return `WebAura chat about ${session.repoSource.owner}/${session.repoSource.repo}@${session.repoSource.ref}`;
  }

  if (session.title && session.title !== "New chat") {
    return `WebAura chat: ${session.title}`;
  }

  return "WebAura chat share";
}

function buildMetadata(
  session: SessionData,
  sourceUrl: string | undefined,
): SessionGistShareMetadata {
  return {
    app: "WebAura",
    exportedAt: new Date().toISOString(),
    format: "webaura-session-gist",
    session: {
      createdAt: session.createdAt,
      messageCount: session.messageCount,
      model: session.model,
      provider: session.provider,
      providerGroup: session.providerGroup,
      repoSource: session.repoSource,
      sourceUrl,
      thinkingLevel: session.thinkingLevel,
      title: session.title,
      updatedAt: session.updatedAt,
    },
    version: 1,
  };
}

function buildGistFiles(input: SessionGistShareInput): Record<string, { content: string }> {
  const stem = buildFileStem(input.session);
  const sourceUrl = trimToUndefined(input.sourceUrl ?? input.session.sourceUrl);
  const markdown = messagesToMarkdown(input.messages, {
    repoSource: input.session.repoSource,
    sourceUrl,
  });
  const metadata = `${JSON.stringify(buildMetadata(input.session, sourceUrl), null, 2)}\n`;

  return {
    [`webaura-${stem}.md`]: { content: markdown },
    [`webaura-${stem}.metadata.json`]: { content: metadata },
  };
}

function getGistPermissionMessage(apiMessage?: string): string {
  const suffix = apiMessage ? ` GitHub said: ${apiMessage}` : "";
  return `GitHub rejected gist creation. Update your fine-grained PAT to include the account permission \`Gists: Read and write\`, then try again.${suffix}`;
}

export async function createSessionGistShare(
  input: SessionGistShareInput,
): Promise<SessionGistShareResult> {
  const token = trimToUndefined(input.token) ?? (await getGithubPersonalAccessToken());

  if (!token) {
    throw new SessionGistShareError(
      "missing_token",
      "Add a GitHub Personal Access Token before sharing as a gist.",
    );
  }

  try {
    const response = await fetch(GITHUB_GISTS_API_URL, {
      body: JSON.stringify({
        description: buildGistDescription(input.session),
        files: buildGistFiles(input),
        public: false,
      }),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method: "POST",
    });

    if (!response.ok) {
      let apiMessage: string | undefined;

      try {
        const body = (await response.json()) as { message?: string };
        apiMessage = trimToUndefined(body.message);
      } catch {
        apiMessage = undefined;
      }

      if (response.status === 401) {
        throw new SessionGistShareError(
          "invalid_token",
          "GitHub rejected the saved token. Update it under GitHub settings and try again.",
          response.status,
        );
      }

      if (response.status === 403 || response.status === 404) {
        throw new SessionGistShareError(
          "insufficient_scope",
          getGistPermissionMessage(apiMessage),
          response.status,
        );
      }

      throw new SessionGistShareError(
        "github_error",
        apiMessage ? `Could not create gist. GitHub said: ${apiMessage}` : "Could not create gist.",
        response.status,
      );
    }

    const data = (await response.json()) as { html_url?: string; id?: string };
    const url = trimToUndefined(data.html_url);
    const id = trimToUndefined(data.id);

    if (!url || !id) {
      throw new SessionGistShareError(
        "github_error",
        "GitHub created an unexpected gist response.",
        response.status,
      );
    }

    return { id, url };
  } catch (error) {
    if (error instanceof SessionGistShareError) {
      throw error;
    }

    throw new SessionGistShareError("network_error", "Could not reach GitHub to create the gist.");
  }
}
