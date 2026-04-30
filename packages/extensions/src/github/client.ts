import { getGithubPersonalAccessToken } from "./token";
import type { JsonValue } from "@webaura/pi/types/common";

const GITHUB_API_BASE_URL = "https://api.github.com";
const MAX_TOOL_TEXT_LENGTH = 24_000;

export function stringifyForTool(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  if (text.length <= MAX_TOOL_TEXT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_TOOL_TEXT_LENGTH)}\n\n[truncated after ${MAX_TOOL_TEXT_LENGTH} characters]`;
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }

  return String(value);
}

export function normalizeRepo(repo: string): string {
  const trimmed = repo.trim();

  if (!/^[^\s/]+\/[^\s/]+$/.test(trimmed)) {
    throw new Error("repo must use owner/name format");
  }

  return trimmed;
}

export function encodeRepoPath(path: string | undefined): string {
  const normalized = path?.trim().replace(/^\/+/, "") ?? "";
  return normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function appendQuery(
  path: string,
  query: Record<string, boolean | number | string | undefined>,
): string {
  const url = new URL(path, GITHUB_API_BASE_URL);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  }

  return `${url.pathname}${url.search}`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return await response.json();
  }

  return await response.text();
}

function getGitHubErrorMessage(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    return `GitHub API request failed (${status}): ${String((body as { message: unknown }).message)}`;
  }

  return `GitHub API request failed (${status})`;
}

export async function githubRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!path.startsWith("/")) {
    throw new Error("GitHub API paths must start with /");
  }

  const token = await getGithubPersonalAccessToken();
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw new Error(getGitHubErrorMessage(response.status, body));
  }

  return body;
}

export function decodeBase64Bytes(content: string): Uint8Array {
  const binary = globalThis.atob(content.replace(/\s/g, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function decodeBase64Text(content: string): string {
  return new TextDecoder().decode(decodeBase64Bytes(content));
}

export function getSearchEndpoint(type: "code" | "issues" | "prs" | "repos" | "users"): string {
  switch (type) {
    case "prs":
      return "issues";
    case "repos":
      return "repositories";
    default:
      return type;
  }
}
