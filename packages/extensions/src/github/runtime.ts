import { Type } from "typebox";
import {
  appendQuery,
  decodeBase64Bytes,
  encodeRepoPath,
  getSearchEndpoint,
  githubRequest,
  normalizeRepo,
  stringifyForTool,
  toJsonValue,
} from "./client";
import { getGithubPersonalAccessToken } from "./token";
import { GITHUB_EXTENSION_DEFAULT_ENABLED, githubExtensionManifest } from "./manifest";
import type { JsonValue } from "@webaura/pi/types/common";
import type { WebAuraExtension } from "@webaura/pi/extensions/types";

type RepoOperation =
  | "blob"
  | "branches"
  | "contents"
  | "get"
  | "read"
  | "readme"
  | "releases"
  | "tags"
  | "tree";
type IssueOperation = "comment" | "close" | "create" | "get" | "list" | "reopen";
type Direction = "asc" | "desc";
type IssueSort = "comments" | "created" | "updated";
type PrSort = "created" | "long-running" | "popularity" | "updated";
type PrOperation =
  | "close"
  | "comment"
  | "create"
  | "diff"
  | "files"
  | "get"
  | "list"
  | "merge"
  | "reopen"
  | "review"
  | "review_comments"
  | "reviews";
type ActionsOperation = "cancel" | "jobs" | "logs" | "rerun" | "run" | "runs" | "workflows";
type SearchType = "code" | "issues" | "prs" | "repos" | "users";

const HttpMethod = Type.Union([
  Type.Literal("GET"),
  Type.Literal("POST"),
  Type.Literal("PUT"),
  Type.Literal("PATCH"),
  Type.Literal("DELETE"),
]);

const SearchTypeSchema = Type.Union([
  Type.Literal("code"),
  Type.Literal("issues"),
  Type.Literal("prs"),
  Type.Literal("repos"),
  Type.Literal("users"),
]);

const RepoOperationSchema = Type.Union([
  Type.Literal("get"),
  Type.Literal("blob"),
  Type.Literal("readme"),
  Type.Literal("read"),
  Type.Literal("contents"),
  Type.Literal("branches"),
  Type.Literal("releases"),
  Type.Literal("tags"),
  Type.Literal("tree"),
]);

const IssueOperationSchema = Type.Union([
  Type.Literal("list"),
  Type.Literal("get"),
  Type.Literal("create"),
  Type.Literal("comment"),
  Type.Literal("close"),
  Type.Literal("reopen"),
]);

const PrOperationSchema = Type.Union([
  Type.Literal("list"),
  Type.Literal("get"),
  Type.Literal("files"),
  Type.Literal("diff"),
  Type.Literal("review_comments"),
  Type.Literal("reviews"),
  Type.Literal("create"),
  Type.Literal("comment"),
  Type.Literal("review"),
  Type.Literal("close"),
  Type.Literal("reopen"),
  Type.Literal("merge"),
]);

const ActionsOperationSchema = Type.Union([
  Type.Literal("workflows"),
  Type.Literal("runs"),
  Type.Literal("run"),
  Type.Literal("jobs"),
  Type.Literal("logs"),
  Type.Literal("rerun"),
  Type.Literal("cancel"),
]);

const IssueStateSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("closed"),
  Type.Literal("all"),
]);

const DirectionSchema = Type.Union([Type.Literal("asc"), Type.Literal("desc")]);

const IssueSortSchema = Type.Union([
  Type.Literal("created"),
  Type.Literal("updated"),
  Type.Literal("comments"),
]);

const PrSortSchema = Type.Union([
  Type.Literal("created"),
  Type.Literal("updated"),
  Type.Literal("popularity"),
  Type.Literal("long-running"),
]);

const MergeMethodSchema = Type.Union([
  Type.Literal("merge"),
  Type.Literal("squash"),
  Type.Literal("rebase"),
]);

const ReviewEventSchema = Type.Union([
  Type.Literal("COMMENT"),
  Type.Literal("APPROVE"),
  Type.Literal("REQUEST_CHANGES"),
]);

const ReviewCommentSideSchema = Type.Union([Type.Literal("LEFT"), Type.Literal("RIGHT")]);

const CreateReviewCommentSchema = Type.Object({
  body: Type.String({ description: "Review comment body" }),
  line: Type.Optional(
    Type.Integer({
      description: "New file line number; provide either line or position",
      minimum: 1,
    }),
  ),
  path: Type.String({ description: "File path in the pull request diff" }),
  position: Type.Optional(
    Type.Integer({
      description: "Legacy diff position; provide either line or position",
      minimum: 1,
    }),
  ),
  side: Type.Optional(ReviewCommentSideSchema),
  startLine: Type.Optional(
    Type.Integer({ description: "Start line for multi-line comments", minimum: 1 }),
  ),
  startSide: Type.Optional(ReviewCommentSideSchema),
});

const QueryValueSchema = Type.Union([Type.Boolean(), Type.Number(), Type.String()]);

const DEFAULT_READ_LIMIT = 200;
const DEFAULT_README_LIMIT = 400;
const MAX_LIST_LIMIT = 100;
const MAX_TEXT_LINE_LIMIT = 2_000;
const MAX_TEXT_RESULT_LENGTH = 24_000;
const GITHUB_CONTENTS_TEXT_LIMIT_BYTES = 1_000_000;

function clampInteger(
  value: number | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const next = Math.floor(value ?? defaultValue);
  return Math.min(Math.max(next, min), max);
}

function toolResult(text: string, details: unknown) {
  return {
    content: [{ text, type: "text" as const }],
    details: toJsonValue(details),
  };
}

function oneLine(value: string | null | undefined, defaultValue = ""): string {
  return (value ?? defaultValue).replace(/\s+/g, " ").trim();
}

function trimText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`;
}

function compactJson(value: unknown): string {
  return trimText(stringifyForTool(value), 16_000);
}

function compactRepo(value: unknown) {
  const repo = requireObjectResponse(value, "GitHub repository");

  return {
    defaultBranch: requireStringField(repo.default_branch, "GitHub repository default_branch"),
    description: optionalStringField(repo.description, "GitHub repository description"),
    fork: requireBooleanField(repo.fork, "GitHub repository fork"),
    forks: requireNumberField(repo.forks_count, "GitHub repository forks_count"),
    fullName: requireStringField(repo.full_name, "GitHub repository full_name"),
    language: optionalStringField(repo.language, "GitHub repository language"),
    openIssues: requireNumberField(repo.open_issues_count, "GitHub repository open_issues_count"),
    private: requireBooleanField(repo.private, "GitHub repository private"),
    stars: requireNumberField(repo.stargazers_count, "GitHub repository stargazers_count"),
    updatedAt: optionalStringField(repo.updated_at, "GitHub repository updated_at"),
    url: optionalStringField(repo.html_url, "GitHub repository html_url"),
  };
}

function formatRepo(repo: ReturnType<typeof compactRepo>): string {
  const flags = [repo.private ? "private" : "public", repo.fork ? "fork" : undefined]
    .filter(Boolean)
    .join(",");
  return [
    repo.fullName,
    `branch=${repo.defaultBranch}`,
    `stars=${repo.stars}`,
    `forks=${repo.forks}`,
    `issues=${repo.openIssues}`,
    `visibility=${flags}`,
    repo.description ? `desc=${repo.description}` : undefined,
    repo.url,
  ]
    .filter(Boolean)
    .join(" | ");
}

function compactDirectory(value: unknown) {
  return {
    entries: requireArrayResponse(value, "GitHub contents directory").map((entry) => {
      const object = requireObjectResponse(entry, "GitHub contents entry");
      return {
        name: optionalStringField(object.name, "GitHub contents entry name"),
        path: optionalStringField(object.path, "GitHub contents entry path"),
        sha: optionalStringField(object.sha, "GitHub contents entry sha"),
        size: optionalNumberField(object.size, "GitHub contents entry size"),
        type: requireStringField(object.type, "GitHub contents entry type"),
        url: optionalStringField(object.html_url, "GitHub contents entry html_url"),
      };
    }),
    kind: "directory" as const,
  };
}

function formatDirectory(entries: ReturnType<typeof compactDirectory>["entries"]): string[] {
  return entries.map((entry) => {
    const size = typeof entry.size === "number" ? ` ${entry.size}b` : "";
    const path = entry.path ?? entry.name;

    if (!entry.type || !path) {
      throw new Error("GitHub contents entry did not include type and path/name");
    }

    return `${entry.type} ${path}${size}`;
  });
}

function compactNameList(value: unknown[]): Array<{ name: string; sha?: string }> {
  return value.map((entry) => {
    const object = requireObjectResponse(entry, "GitHub name list entry");
    const commit = objectField(object.commit);

    return {
      name: requireStringField(object.name, "GitHub name list entry name"),
      sha: optionalStringField(commit?.sha, "GitHub name list entry commit sha"),
    };
  });
}

function requireObjectResponse(value: unknown, label: string): Record<string, unknown> {
  const object = objectField(value);

  if (!object) {
    throw new Error(`${label} returned an unexpected non-object response`);
  }

  return object;
}

function requireArrayResponse(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} returned an unexpected non-array response`);
  }

  return value;
}

function requireObjectArrayField(
  object: Record<string, unknown>,
  fieldName: string,
  label: string,
): Array<Record<string, unknown>> {
  const value = object[fieldName];

  if (!Array.isArray(value) || value.some((item) => !objectField(item))) {
    throw new Error(`${label} response field ${fieldName} was not an object array`);
  }

  return value as Array<Record<string, unknown>>;
}

type TextReadWindow = {
  count: number;
  endLine: number;
  lineNumbers: boolean;
  limit: number;
  nextOffset?: number;
  offset: number;
  rendered: string;
  totalLines: number;
  truncated: boolean;
  truncatedBy?: "length" | "lines";
};

function normalizeTextLines(content: string): string[] {
  return content.replace(/\r/g, "").split("\n");
}

function formatNumberedLines(lines: readonly string[], startLine: number): string {
  if (lines.length === 0) {
    return "";
  }

  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, " ")}\t${line}`)
    .join("\n");
}

function renderTextLines(
  lines: readonly string[],
  startLine: number,
  lineNumbers: boolean,
): string {
  return lineNumbers ? formatNumberedLines(lines, startLine) : lines.join("\n");
}

function findFittingLineCount(params: {
  lineNumbers: boolean;
  lines: readonly string[];
  maxLength: number;
  startLine: number;
}): number {
  const lineNumberWidth = String(params.startLine + params.lines.length - 1).length;
  let length = 0;

  for (let index = 0; index < params.lines.length; index += 1) {
    const line = params.lines[index] ?? "";
    const renderedLineLength = params.lineNumbers ? lineNumberWidth + 1 + line.length : line.length;
    const nextLength = length + (index === 0 ? 0 : 1) + renderedLineLength;

    if (nextLength > params.maxLength) {
      return index;
    }

    length = nextLength;
  }

  return params.lines.length;
}

function buildTextReadWindowFromSelectedLines(params: {
  lineNumbers: boolean | undefined;
  limit: number;
  offset: number;
  path: string;
  selectedLines: readonly string[];
  totalLines: number;
}): TextReadWindow {
  const offset = params.offset;
  const startIndex = offset - 1;

  if (startIndex >= params.totalLines) {
    throw new Error(`Offset ${offset} is beyond end of file (${params.totalLines} lines total)`);
  }

  const lineLimited = startIndex + params.selectedLines.length < params.totalLines;
  const lineNumbers = Boolean(params.lineNumbers);
  const fittingLineCount = findFittingLineCount({
    lineNumbers,
    lines: params.selectedLines,
    maxLength: MAX_TEXT_RESULT_LENGTH,
    startLine: offset,
  });

  if (params.selectedLines.length > 0 && fittingLineCount === 0) {
    const nextOffset = offset + 1;
    return {
      count: 0,
      endLine: offset,
      lineNumbers,
      limit: params.limit,
      nextOffset,
      offset,
      rendered: `[Line ${offset} in ${params.path} exceeds the ${MAX_TEXT_RESULT_LENGTH} character result limit. Use a smaller range with offset/limit.]`,
      totalLines: params.totalLines,
      truncated: true,
      truncatedBy: "length",
    };
  }

  const shownLines = params.selectedLines.slice(0, fittingLineCount);
  const lengthLimited = fittingLineCount < params.selectedLines.length;
  const endLine = offset + shownLines.length - 1;
  const nextOffset = lengthLimited
    ? endLine + 1
    : lineLimited
      ? startIndex + params.selectedLines.length + 1
      : undefined;
  let rendered = renderTextLines(shownLines, offset, lineNumbers);

  if (lengthLimited && nextOffset) {
    rendered += `\n\n[Showing lines ${offset}-${endLine} of ${params.totalLines}. Use offset=${nextOffset} to continue.]`;
  } else if (lineLimited && nextOffset) {
    const remaining = params.totalLines - (nextOffset - 1);
    rendered += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
  }

  return {
    count: shownLines.length,
    endLine,
    lineNumbers,
    limit: params.limit,
    nextOffset,
    offset,
    rendered,
    totalLines: params.totalLines,
    truncated: nextOffset !== undefined,
    truncatedBy: lengthLimited ? "length" : lineLimited ? "lines" : undefined,
  };
}

function buildTextReadWindow(params: {
  content: string;
  lineNumbers: boolean | undefined;
  limit: number;
  offset: number;
  path: string;
}): TextReadWindow {
  const allLines = normalizeTextLines(params.content);
  const startIndex = params.offset - 1;

  return buildTextReadWindowFromSelectedLines({
    lineNumbers: params.lineNumbers,
    limit: params.limit,
    offset: params.offset,
    path: params.path,
    selectedLines: allLines.slice(startIndex, startIndex + params.limit),
    totalLines: allLines.length,
  });
}

function compactTextMatches(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("GitHub search response text_matches field was not an array");
  }

  return value.map((entry) => {
    const match = requireObjectResponse(entry, "GitHub search text match");
    const ranges = match.matches;

    if (ranges !== undefined && !Array.isArray(ranges)) {
      throw new Error("GitHub search text match matches field was not an array");
    }

    return {
      fragment: requireStringField(match.fragment, "GitHub search text match fragment"),
      matches: ranges?.map((range) => {
        const item = requireObjectResponse(range, "GitHub search text match range");
        const indices = item.indices;

        if (indices !== undefined && !Array.isArray(indices)) {
          throw new Error("GitHub search text match range indices field was not an array");
        }

        return {
          indices: indices?.map((index) =>
            requireNumberField(index, "GitHub search text match range index"),
          ),
          text: requireStringField(item.text, "GitHub search text match range text"),
        };
      }),
      objectType: requireStringField(match.object_type, "GitHub search text match object_type"),
      property: requireStringField(match.property, "GitHub search text match property"),
    };
  });
}

function compactSearchItem(type: SearchType, item: Record<string, unknown>) {
  if (type === "repos") {
    return {
      description: stringField(item.description),
      fullName: requireStringField(item.full_name, "GitHub repository search full_name"),
      language: stringField(item.language),
      stars: requireNumberField(item.stargazers_count, "GitHub repository search stargazers_count"),
      url: stringField(item.html_url),
    };
  }

  if (type === "users") {
    return {
      login: requireStringField(item.login, "GitHub user search login"),
      type: stringField(item.type),
      url: stringField(item.html_url),
    };
  }

  if (type === "code") {
    const repository = requireObjectResponse(item.repository, "GitHub code search repository");
    return {
      path: requireStringField(item.path, "GitHub code search path"),
      repo: requireStringField(repository.full_name, "GitHub code search repository full_name"),
      sha: stringField(item.sha),
      textMatches: compactTextMatches(item.text_matches),
      url: stringField(item.html_url),
    };
  }

  const repositoryUrl = requireStringField(
    item.repository_url,
    "GitHub issue search repository_url",
  );
  return {
    number: requireNumberField(item.number, "GitHub issue search number"),
    repo: repositoryUrl.replace("https://api.github.com/repos/", ""),
    state: requireStringField(item.state, "GitHub issue search state"),
    title: requireStringField(item.title, "GitHub issue search title"),
    url: stringField(item.html_url),
  };
}

function formatSearchItem(type: SearchType, item: ReturnType<typeof compactSearchItem>): string {
  if (type === "repos") {
    const repo = item as ReturnType<typeof compactSearchItem> & {
      description?: string;
      fullName: string;
      language?: string;
      stars: number;
    };
    const desc = oneLine(repo.description, "");
    return `${repo.fullName} ★${repo.stars}${repo.language ? ` ${repo.language}` : ""}${desc ? ` — ${desc}` : ""}`;
  }

  if (type === "users") {
    const user = item as ReturnType<typeof compactSearchItem> & { login: string; type?: string };
    return `${user.login}${user.type ? ` ${user.type}` : ""}`;
  }

  if (type === "code") {
    const code = item as ReturnType<typeof compactSearchItem> & {
      path: string;
      repo: string;
      textMatches?: Array<{ fragment?: string }>;
    };
    const fragment = code.textMatches?.[0]?.fragment;
    return `${code.repo}/${code.path}${fragment ? `\n${trimText(fragment, 500)}` : ""}`;
  }

  const issue = item as ReturnType<typeof compactSearchItem> & {
    number: number;
    repo: string;
    state: string;
    title: string;
  };
  return `${issue.repo}#${issue.number} ${issue.state} ${oneLine(issue.title, "")}`;
}

function compactSearchResponse(type: SearchType, value: unknown) {
  const body = requireObjectResponse(value, "GitHub search");
  const incomplete = body.incomplete_results;
  const total = body.total_count;

  if (typeof incomplete !== "boolean") {
    throw new Error("GitHub search response field incomplete_results was not a boolean");
  }

  if (typeof total !== "number") {
    throw new Error("GitHub search response field total_count was not a number");
  }

  const items = requireObjectArrayField(body, "items", "GitHub search").map((item) =>
    compactSearchItem(type, item),
  );

  return {
    incomplete,
    items,
    returned: items.length,
    total,
  };
}

function hasCodeSearchScope(query: string): boolean {
  return /(?:^|\s)(?:org|repo|user):[^\s]+/i.test(query);
}

function assertMutationAllowed(params: {
  confirmMutation: boolean | undefined;
  isMutation: boolean;
}): void {
  if (!params.isMutation || params.confirmMutation) {
    return;
  }

  throw new Error("Non-read GitHub API calls require confirmMutation=true.");
}

function formatReadOutput(params: {
  path: string;
  ref?: string;
  repo: string;
  window: TextReadWindow;
}): string {
  const continuation = params.window.nextOffset ? ` nextOffset=${params.window.nextOffset}` : "";
  const ref = params.ref ? ` @ ${params.ref}` : "";
  return `file: ${params.repo}/${params.path}${ref}\nlines: ${params.window.offset}-${params.window.endLine}/${params.window.totalLines}${continuation}\n\n${params.window.rendered}`;
}

function lineDetails(window: TextReadWindow) {
  return {
    count: window.count,
    endLine: window.endLine,
    limit: window.limit,
    lineNumbers: window.lineNumbers,
    nextOffset: window.nextOffset,
    offset: window.offset,
    totalLines: window.totalLines,
    truncated: window.truncated,
    truncatedBy: window.truncatedBy,
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function requireStringField(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} did not include a string value`);
  }

  return value;
}

function requireNumberField(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} did not include a number value`);
  }

  return value;
}

function requireBooleanField(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} did not include a boolean value`);
  }

  return value;
}

function optionalStringField(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireStringField(value, label);
}

function optionalNumberField(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireNumberField(value, label);
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

type GitHubContentFile = {
  content?: string;
  encoding?: string;
  html_url?: string;
  name?: string;
  path?: string;
  sha?: string;
  size?: number;
};

type GitHubBlob = {
  content?: string;
  encoding?: string;
  sha?: string;
  size?: number;
};

function compactContentFile(value: unknown, label: string): GitHubContentFile {
  const file = requireObjectResponse(value, label);

  return {
    content: optionalStringField(file.content, `${label} content`),
    encoding: optionalStringField(file.encoding, `${label} encoding`),
    html_url: optionalStringField(file.html_url, `${label} html_url`),
    name: optionalStringField(file.name, `${label} name`),
    path: optionalStringField(file.path, `${label} path`),
    sha: optionalStringField(file.sha, `${label} sha`),
    size: optionalNumberField(file.size, `${label} size`),
  };
}

function compactGitBlob(value: unknown): GitHubBlob {
  const blob = requireObjectResponse(value, "GitHub blob");

  return {
    content: optionalStringField(blob.content, "GitHub blob content"),
    encoding: optionalStringField(blob.encoding, "GitHub blob encoding"),
    sha: optionalStringField(blob.sha, "GitHub blob sha"),
    size: optionalNumberField(blob.size, "GitHub blob size"),
  };
}

type DecodedRepositoryFile = {
  binary: boolean;
  content?: string;
  file: {
    name?: string;
    path: string;
    sha?: string;
    size: number;
    url?: string;
  };
};

function isLikelyBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }

  let controlBytes = 0;

  for (const byte of bytes) {
    if (byte === 0) {
      return true;
    }

    const isAllowedWhitespace = byte === 9 || byte === 10 || byte === 12 || byte === 13;
    if (byte < 32 && !isAllowedWhitespace) {
      controlBytes += 1;
    }
  }

  return controlBytes > Math.max(8, bytes.length * 0.01);
}

function decodeBase64RepositoryContent(params: {
  content?: string;
  encoding?: string;
  name?: string;
  path: string;
  sha?: string;
  size?: number;
  url?: string;
}): DecodedRepositoryFile {
  if (params.encoding !== "base64" || typeof params.content !== "string") {
    throw new Error(`GitHub response for ${params.path} did not include base64 text content`);
  }

  const bytes = decodeBase64Bytes(params.content);
  const baseFile = {
    name: params.name,
    path: params.path,
    sha: params.sha,
    size: params.size ?? bytes.byteLength,
    url: params.url,
  };

  if (isLikelyBinary(bytes)) {
    return {
      binary: true,
      file: baseFile,
    };
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      binary: true,
      file: baseFile,
    };
  }

  return {
    binary: false,
    content,
    file: baseFile,
  };
}

function decodeRepositoryFile(file: GitHubContentFile, pathLabel: string): DecodedRepositoryFile {
  const path = file.path ?? pathLabel;

  return decodeBase64RepositoryContent({
    content: file.content,
    encoding: file.encoding,
    name: file.name,
    path,
    sha: file.sha,
    size: file.size,
    url: file.html_url,
  });
}

function decodeGitBlob(blob: GitHubBlob, path: string): DecodedRepositoryFile {
  return decodeBase64RepositoryContent({
    content: blob.content,
    encoding: blob.encoding,
    path,
    sha: blob.sha,
    size: blob.size,
  });
}

function formatBinaryReadOutput(params: {
  file: DecodedRepositoryFile["file"];
  ref?: string;
  repo: string;
}): string {
  const ref = params.ref ? ` @ ${params.ref}` : "";
  return `file: ${params.repo}/${params.file.path}${ref}\n\n[Binary file, size: ${params.file.size} bytes]`;
}

function formatDecodedReadResult(params: {
  decoded: DecodedRepositoryFile;
  limit: number;
  lineNumbers: boolean | undefined;
  offset: number;
  ref?: string;
  repo: string;
}) {
  if (params.decoded.binary) {
    return toolResult(
      formatBinaryReadOutput({ file: params.decoded.file, ref: params.ref, repo: params.repo }),
      {
        binary: true,
        file: params.decoded.file,
        ref: params.ref,
        repo: params.repo,
      },
    );
  }

  if (params.decoded.content === undefined) {
    throw new Error(`GitHub response for ${params.decoded.file.path} did not include text content`);
  }

  const window = buildTextReadWindow({
    content: params.decoded.content,
    lineNumbers: params.lineNumbers,
    limit: params.limit,
    offset: params.offset,
    path: params.decoded.file.path,
  });

  return toolResult(
    formatReadOutput({
      path: params.decoded.file.path,
      ref: params.ref,
      repo: params.repo,
      window,
    }),
    {
      content: window.rendered,
      file: params.decoded.file,
      lines: lineDetails(window),
      ref: params.ref,
      repo: params.repo,
    },
  );
}

async function readGitBlobResult(params: {
  lineNumbers: boolean | undefined;
  limit: number;
  offset: number;
  path: string;
  ref?: string;
  repo: string;
  sha: string;
}) {
  const response = await githubRequest(
    `/repos/${params.repo}/git/blobs/${encodeURIComponent(params.sha)}`,
  );
  const decoded = decodeGitBlob(compactGitBlob(response), params.path);

  return formatDecodedReadResult({
    decoded,
    limit: params.limit,
    lineNumbers: params.lineNumbers,
    offset: params.offset,
    ref: params.ref,
    repo: params.repo,
  });
}

async function readLargeContentViaBlob(params: {
  file: GitHubContentFile;
  lineNumbers: boolean | undefined;
  limit: number;
  offset: number;
  pathLabel: string;
  ref?: string;
  repo: string;
}) {
  const path = params.file.path ?? params.pathLabel;
  const size = params.file.size;

  if (size === undefined || size <= GITHUB_CONTENTS_TEXT_LIMIT_BYTES) {
    return undefined;
  }

  const sha = params.file.sha?.trim();
  if (!sha) {
    throw new Error(
      `File ${path} is too large for GitHub contents text reads (${size} bytes > ${GITHUB_CONTENTS_TEXT_LIMIT_BYTES} bytes). Use github_repo operation=tree or github_search to locate the file sha, then operation=blob.`,
    );
  }

  return await readGitBlobResult({
    lineNumbers: params.lineNumbers,
    limit: params.limit,
    offset: params.offset,
    path,
    ref: params.ref,
    repo: params.repo,
    sha,
  });
}

async function readRepositoryContentFile(params: {
  defaultLimit: number;
  file: GitHubContentFile;
  lineNumbers: boolean | undefined;
  limit: number | undefined;
  offset: number | undefined;
  pathLabel: string;
  ref?: string;
  repo: string;
}) {
  const limit = clampInteger(params.limit, params.defaultLimit, 1, MAX_TEXT_LINE_LIMIT);
  const offset = clampInteger(params.offset, 1, 1, Number.MAX_SAFE_INTEGER);
  const largeFileResult = await readLargeContentViaBlob({
    file: params.file,
    lineNumbers: params.lineNumbers,
    limit,
    offset,
    pathLabel: params.pathLabel,
    ref: params.ref,
    repo: params.repo,
  });

  if (largeFileResult) {
    return largeFileResult;
  }

  return formatDecodedReadResult({
    decoded: decodeRepositoryFile(params.file, params.pathLabel),
    limit,
    lineNumbers: params.lineNumbers,
    offset,
    ref: params.ref,
    repo: params.repo,
  });
}

function compactLabels(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("GitHub labels field was not an array");
  }

  return value.map((label) => {
    if (typeof label === "string") {
      return label;
    }

    return requireStringField(objectField(label)?.name, "GitHub label name");
  });
}

function compactUsers(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("GitHub users field was not an array");
  }

  return value.map((user) => requireStringField(objectField(user)?.login, "GitHub user login"));
}

function compactIssue(value: unknown, includeBody = false) {
  const issue = requireObjectResponse(value, "GitHub issue");
  const user = objectField(issue.user);

  return {
    assignees: compactUsers(issue.assignees),
    author: stringField(user?.login),
    body: includeBody ? stringField(issue.body) : undefined,
    comments: numberField(issue.comments),
    createdAt: stringField(issue.created_at),
    labels: compactLabels(issue.labels),
    number: requireNumberField(issue.number, "GitHub issue number"),
    state: requireStringField(issue.state, "GitHub issue state"),
    title: requireStringField(issue.title, "GitHub issue title"),
    updatedAt: stringField(issue.updated_at),
    url: stringField(issue.html_url),
  };
}

function compactIssueComment(value: unknown) {
  const comment = requireObjectResponse(value, "GitHub issue comment");
  const user = objectField(comment.user);

  return {
    author: stringField(user?.login),
    body: stringField(comment.body),
    createdAt: stringField(comment.created_at),
    url: stringField(comment.html_url),
  };
}

function formatIssueLine(issue: ReturnType<typeof compactIssue>): string {
  return `#${issue.number} ${issue.state} ${oneLine(issue.title, "")}`.trim();
}

function compactPr(value: unknown, includeBody = false) {
  const pr = requireObjectResponse(value, "GitHub pull request");
  const user = objectField(pr.user);
  const base = objectField(pr.base);
  const head = objectField(pr.head);

  return {
    additions: numberField(pr.additions),
    author: stringField(user?.login),
    base: stringField(base?.ref),
    body: includeBody ? stringField(pr.body) : undefined,
    changedFiles: numberField(pr.changed_files),
    comments: numberField(pr.comments),
    commits: numberField(pr.commits),
    createdAt: stringField(pr.created_at),
    deletions: numberField(pr.deletions),
    draft: requireBooleanField(pr.draft, "GitHub pull request draft"),
    head: stringField(head?.ref),
    merged: optionalStringField(pr.merged_at, "GitHub pull request merged_at") !== undefined,
    number: requireNumberField(pr.number, "GitHub pull request number"),
    reviewComments: numberField(pr.review_comments),
    state: requireStringField(pr.state, "GitHub pull request state"),
    title: requireStringField(pr.title, "GitHub pull request title"),
    updatedAt: stringField(pr.updated_at),
    url: stringField(pr.html_url),
  };
}

function compactPrFile(value: unknown) {
  const file = requireObjectResponse(value, "GitHub pull request file");

  return {
    additions: numberField(file.additions),
    changes: numberField(file.changes),
    deletions: numberField(file.deletions),
    filename: requireStringField(file.filename, "GitHub pull request file filename"),
    patch: stringField(file.patch),
    status: requireStringField(file.status, "GitHub pull request file status"),
  };
}

function compactReviewComment(value: unknown) {
  const comment = requireObjectResponse(value, "GitHub PR review comment");
  const user = objectField(comment.user);

  return {
    author: stringField(user?.login),
    body: stringField(comment.body),
    commitId: stringField(comment.commit_id),
    createdAt: stringField(comment.created_at),
    diffHunk: stringField(comment.diff_hunk),
    id: numberField(comment.id),
    line: numberField(comment.line),
    originalLine: numberField(comment.original_line),
    path: requireStringField(comment.path, "GitHub PR review comment path"),
    side: stringField(comment.side),
    startLine: numberField(comment.start_line),
    updatedAt: stringField(comment.updated_at),
    url: stringField(comment.html_url),
  };
}

function compactPullRequestReview(value: unknown) {
  const review = requireObjectResponse(value, "GitHub pull request review");
  const user = objectField(review.user);

  return {
    author: stringField(user?.login),
    body: stringField(review.body),
    commitId: stringField(review.commit_id),
    id: requireNumberField(review.id, "GitHub pull request review id"),
    state: requireStringField(review.state, "GitHub pull request review state"),
    submittedAt: stringField(review.submitted_at),
    url: stringField(review.html_url),
  };
}

function formatCommentBodyPreview(value: string | undefined): string {
  return trimText(value ?? "", 500)
    .replace(/\r?\n/g, "\t")
    .trim();
}

function formatReviewCommentLine(comment: ReturnType<typeof compactReviewComment>): string {
  const line = comment.line ?? comment.originalLine;
  const body = formatCommentBodyPreview(comment.body);
  const author = comment.author ? ` ${comment.author}` : "";
  return `${comment.path}${line ? `:${line}` : ""}${author}${body ? ` ${body}` : ""}`.trim();
}

function formatPullRequestReviewLine(review: ReturnType<typeof compactPullRequestReview>): string {
  const author = review.author ? ` ${review.author}` : "";
  const body = formatCommentBodyPreview(review.body);
  return `${review.state}${author}${body ? ` ${body}` : ""}`.trim();
}

function formatPrLine(pr: ReturnType<typeof compactPr>): string {
  const draft = pr.draft ? " draft" : "";
  return `#${pr.number} ${pr.state}${draft} ${oneLine(pr.title, "")}`.trim();
}

function compactTreeEntry(value: unknown) {
  const entry = requireObjectResponse(value, "GitHub tree entry");

  return {
    mode: stringField(entry.mode),
    path: requireStringField(entry.path, "GitHub tree entry path"),
    sha: stringField(entry.sha),
    size: numberField(entry.size),
    type: requireStringField(entry.type, "GitHub tree entry type"),
    url: stringField(entry.url),
  };
}

function formatTreeLine(entry: ReturnType<typeof compactTreeEntry>): string {
  const size = entry.size !== undefined ? ` ${entry.size}b` : "";
  return `${entry.type} ${entry.path}${size}`;
}

function compactWorkflow(value: unknown) {
  const workflow = requireObjectResponse(value, "GitHub Actions workflow");

  return {
    createdAt: stringField(workflow.created_at),
    id: requireNumberField(workflow.id, "GitHub Actions workflow id"),
    name: requireStringField(workflow.name, "GitHub Actions workflow name"),
    path: stringField(workflow.path),
    state: stringField(workflow.state),
    updatedAt: stringField(workflow.updated_at),
    url: stringField(workflow.html_url),
  };
}

function compactRun(value: unknown) {
  const run = requireObjectResponse(value, "GitHub Actions run");
  const actor = objectField(run.actor);

  return {
    actor: stringField(actor?.login),
    branch: stringField(run.head_branch),
    conclusion: stringField(run.conclusion),
    createdAt: stringField(run.created_at),
    displayTitle: stringField(run.display_title),
    event: stringField(run.event),
    id: requireNumberField(run.id, "GitHub Actions run id"),
    name: stringField(run.name),
    sha: stringField(run.head_sha),
    status: requireStringField(run.status, "GitHub Actions run status"),
    updatedAt: stringField(run.updated_at),
    url: stringField(run.html_url),
    workflowId: numberField(run.workflow_id),
  };
}

function formatRunLine(run: ReturnType<typeof compactRun>): string {
  const conclusion = run.conclusion ? `/${run.conclusion}` : "";
  const title = oneLine(run.displayTitle ?? run.name, "");
  return `${run.id} ${run.status}${conclusion} ${title}`.trim();
}

function compactJob(value: unknown) {
  const job = requireObjectResponse(value, "GitHub Actions job");

  return {
    completedAt: stringField(job.completed_at),
    conclusion: stringField(job.conclusion),
    id: requireNumberField(job.id, "GitHub Actions job id"),
    name: requireStringField(job.name, "GitHub Actions job name"),
    startedAt: stringField(job.started_at),
    status: requireStringField(job.status, "GitHub Actions job status"),
    url: stringField(job.html_url),
  };
}

function formatJobLine(job: ReturnType<typeof compactJob>): string {
  const conclusion = job.conclusion ? `/${job.conclusion}` : "";
  return `${job.id} ${job.status}${conclusion} ${oneLine(job.name, "")}`.trim();
}

function requireNumber(value: number | undefined, toolName: string, operation: string): number {
  if (typeof value !== "number") {
    throw new Error(`${toolName} operation=${operation} requires number`);
  }

  return value;
}

function quoteSearchQualifierValue(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function createReviewCommentPayload(comment: {
  body: string;
  line?: number;
  path: string;
  position?: number;
  side?: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
}) {
  if (!comment.body.trim() || !comment.path.trim()) {
    throw new Error("github_pr reviewComments entries require body and path");
  }

  const hasLine = comment.line !== undefined;
  const hasPosition = comment.position !== undefined;

  if (hasLine === hasPosition) {
    throw new Error("github_pr reviewComments entries require exactly one of line or position");
  }

  if (comment.startLine !== undefined && !hasLine) {
    throw new Error("github_pr reviewComments startLine requires line");
  }

  return {
    body: comment.body,
    line: comment.line,
    path: comment.path,
    position: comment.position,
    side: comment.side,
    start_line: comment.startLine,
    start_side: comment.startSide,
  };
}

function queryRecord(
  value: unknown,
): Record<string, boolean | number | string | undefined> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const object = requireObjectResponse(value, "github_api query");
  const query: Record<string, boolean | number | string | undefined> = {};

  for (const [key, entry] of Object.entries(object)) {
    if (
      entry !== undefined &&
      typeof entry !== "boolean" &&
      typeof entry !== "number" &&
      typeof entry !== "string"
    ) {
      throw new Error(`github_api query.${key} must be a string, number, or boolean`);
    }

    query[key] = entry;
  }

  return query;
}

function stripGraphqlCommentsAndStrings(query: string): string {
  let output = "";
  let index = 0;

  while (index < query.length) {
    const char = query[index];

    if (char === "#" || query.startsWith("//", index)) {
      const width = char === "#" ? 1 : 2;
      output += " ".repeat(width);
      index += width;
      while (index < query.length && query[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (query.startsWith("/*", index)) {
      output += "  ";
      index += 2;
      while (index < query.length && !query.startsWith("*/", index)) {
        output += query[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (query.startsWith("*/", index)) {
        output += "  ";
        index += 2;
      }
      continue;
    }

    if (query.startsWith('"""', index)) {
      output += "   ";
      index += 3;
      while (index < query.length && !query.startsWith('"""', index)) {
        output += query[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (query.startsWith('"""', index)) {
        output += "   ";
        index += 3;
      }
      continue;
    }

    if (char === '"') {
      output += " ";
      index += 1;
      while (index < query.length) {
        const next = query[index];
        output += next === "\n" ? "\n" : " ";
        index += next === "\\" ? 2 : 1;
        if (next === '"') {
          break;
        }
      }
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function skipGraphqlIgnored(text: string, index: number): number {
  let next = index;

  while (next < text.length && /[\s,]/.test(text[next] ?? "")) {
    next += 1;
  }

  return next;
}

function readGraphqlName(text: string, index: number): { index: number; name: string } | undefined {
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index));

  if (!match) {
    return undefined;
  }

  return {
    index: index + match[0].length,
    name: match[0],
  };
}

function skipGraphqlSelectionSet(text: string, index: number): number {
  const start = text.indexOf("{", index);

  if (start === -1) {
    return text.length;
  }

  let depth = 0;
  for (let next = start; next < text.length; next += 1) {
    const char = text[next];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return next + 1;
      }
    }
  }

  return text.length;
}

function isGraphqlMutation(query: string): boolean {
  const text = stripGraphqlCommentsAndStrings(query);
  let index = 0;

  while (index < text.length) {
    index = skipGraphqlIgnored(text, index);

    if (text[index] === "{") {
      return false;
    }

    const token = readGraphqlName(text, index);

    if (!token) {
      return false;
    }

    const name = token.name.toLowerCase();

    if (name === "mutation") {
      return true;
    }

    if (name === "query" || name === "subscription") {
      return false;
    }

    if (name === "fragment") {
      index = skipGraphqlSelectionSet(text, token.index);
      continue;
    }

    return false;
  }

  return false;
}

function buildIssueSearchQuery(params: {
  assignee?: string;
  labels?: string[];
  repo: string;
  search?: string;
  state?: "all" | "closed" | "open";
}): string {
  const qualifiers = [`repo:${params.repo}`, "is:issue"];

  if (params.search?.trim()) {
    qualifiers.push(params.search.trim());
  }

  if (params.state && params.state !== "all") {
    qualifiers.push(`is:${params.state}`);
  }

  if (params.assignee?.trim()) {
    qualifiers.push(`assignee:${quoteSearchQualifierValue(params.assignee.trim())}`);
  }

  for (const label of params.labels ?? []) {
    if (label.trim()) {
      qualifiers.push(`label:${quoteSearchQualifierValue(label.trim())}`);
    }
  }

  return qualifiers.join(" ");
}

async function runIssueTool(params: {
  assignee?: string;
  body?: string;
  direction?: Direction;
  includeComments?: boolean;
  labels?: string[];
  limit?: number;
  number?: number;
  operation: IssueOperation;
  page?: number;
  repo: string;
  search?: string;
  sort?: IssueSort;
  state?: "all" | "closed" | "open";
  title?: string;
}) {
  const repo = normalizeRepo(params.repo);
  const operation = params.operation;
  const perPage = clampInteger(params.limit, 20, 1, MAX_LIST_LIMIT);
  const page = clampInteger(params.page, 1, 1, 100);

  if (operation === "list") {
    const query = buildIssueSearchQuery({
      assignee: params.assignee,
      labels: params.labels,
      repo,
      search: params.search,
      state: params.state,
    });
    const response = await githubRequest(
      appendQuery("/search/issues", {
        order: params.direction,
        page,
        per_page: perPage,
        q: query,
        sort: params.sort,
      }),
    );
    const body = requireObjectResponse(response, "GitHub issue search");
    const total = requireNumberField(body.total_count, "GitHub issue search total_count");
    const incomplete = body.incomplete_results;

    if (typeof incomplete !== "boolean") {
      throw new Error("GitHub issue search incomplete_results did not include a boolean value");
    }

    const issues = requireObjectArrayField(body, "items", "GitHub issue search").map((issue) =>
      compactIssue(issue),
    );

    return toolResult(
      `${repo} issues page=${page} total=${total} returned=${issues.length} incomplete=${incomplete}\n${issues.map(formatIssueLine).join("\n")}`,
      {
        direction: params.direction,
        incomplete,
        issues,
        page,
        query,
        repo,
        searchResultCap: total > 1_000 ? 1_000 : undefined,
        sort: params.sort,
        state: params.state,
        total,
      },
    );
  }

  if (operation === "create") {
    if (!params.title?.trim()) {
      throw new Error("github_issue operation=create requires title");
    }

    const response = await githubRequest(`/repos/${repo}/issues`, {
      body: JSON.stringify({
        assignees: params.assignee ? [params.assignee] : undefined,
        body: params.body,
        labels: params.labels,
        title: params.title,
      }),
      method: "POST",
    });
    const issue = compactIssue(response, true);

    return toolResult(`created issue ${repo}#${issue.number}\n${issue.url ?? ""}`.trim(), {
      issue,
      repo,
    });
  }

  const number = requireNumber(params.number, "github_issue", operation);

  if (operation === "get") {
    const response = await githubRequest(`/repos/${repo}/issues/${number}`);
    const issue = compactIssue(response, true);
    const commentsResponse = params.includeComments
      ? await githubRequest(
          appendQuery(`/repos/${repo}/issues/${number}/comments`, { page, per_page: perPage }),
        )
      : undefined;
    const comments = commentsResponse
      ? requireArrayResponse(commentsResponse, "GitHub issue comments").map((comment) =>
          compactIssueComment(comment),
        )
      : undefined;

    return toolResult(`${repo}#${issue.number} ${issue.state} ${oneLine(issue.title, "")}`.trim(), {
      comments,
      commentsPage: params.includeComments ? page : undefined,
      issue,
      repo,
    });
  }

  if (operation === "comment") {
    if (!params.body?.trim()) {
      throw new Error("github_issue operation=comment requires body");
    }

    const response = await githubRequest(`/repos/${repo}/issues/${number}/comments`, {
      body: JSON.stringify({ body: params.body }),
      method: "POST",
    });
    const comment = compactIssueComment(response);

    return toolResult(`commented on issue ${repo}#${number}\n${comment.url ?? ""}`.trim(), {
      comment,
      number,
      repo,
    });
  }

  const response = await githubRequest(`/repos/${repo}/issues/${number}`, {
    body: JSON.stringify({ state: operation === "close" ? "closed" : "open" }),
    method: "PATCH",
  });
  const issue = compactIssue(response, true);

  return toolResult(`${operation} issue ${repo}#${number}\n${issue.url ?? ""}`.trim(), {
    issue,
    repo,
  });
}

async function runPrTool(params: {
  base?: string;
  body?: string;
  commitId?: string;
  commitMessage?: string;
  commitTitle?: string;
  direction?: Direction;
  draft?: boolean;
  head?: string;
  includeComments?: boolean;
  includeFiles?: boolean;
  includeReviewComments?: boolean;
  includeReviews?: boolean;
  lineNumbers?: boolean;
  limit?: number;
  mergeMethod?: "merge" | "rebase" | "squash";
  number?: number;
  offset?: number;
  operation: PrOperation;
  page?: number;
  repo: string;
  reviewComments?: Array<{
    body: string;
    line?: number;
    path: string;
    position?: number;
    side?: "LEFT" | "RIGHT";
    startLine?: number;
    startSide?: "LEFT" | "RIGHT";
  }>;
  reviewEvent?: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  sha?: string;
  sort?: PrSort;
  state?: "all" | "closed" | "open";
  title?: string;
}) {
  const repo = normalizeRepo(params.repo);
  const operation = params.operation;
  const perPage = clampInteger(params.limit, 20, 1, MAX_LIST_LIMIT);
  const page = clampInteger(params.page, 1, 1, 100);

  if (operation === "list") {
    const response = await githubRequest(
      appendQuery(`/repos/${repo}/pulls`, {
        base: params.base,
        head: params.head,
        direction: params.direction,
        page,
        per_page: perPage,
        sort: params.sort,
        state: params.state,
      }),
    );
    const pullRequests = requireArrayResponse(response, "GitHub pull requests list").map((pr) =>
      compactPr(requireObjectResponse(pr, "GitHub pull request")),
    );

    return toolResult(
      `${repo} pull requests page=${page} returned=${pullRequests.length}\n${pullRequests.map(formatPrLine).join("\n")}`,
      {
        direction: params.direction,
        page,
        pullRequests,
        repo,
        sort: params.sort,
        state: params.state,
      },
    );
  }

  if (operation === "create") {
    if (!params.title?.trim() || !params.head?.trim() || !params.base?.trim()) {
      throw new Error("github_pr operation=create requires title, head, and base");
    }

    const response = await githubRequest(`/repos/${repo}/pulls`, {
      body: JSON.stringify({
        base: params.base,
        body: params.body,
        draft: params.draft,
        head: params.head,
        title: params.title,
      }),
      method: "POST",
    });
    const pullRequest = compactPr(response, true);

    return toolResult(
      `created pull request ${repo}#${pullRequest.number}\n${pullRequest.url ?? ""}`.trim(),
      {
        pullRequest,
        repo,
      },
    );
  }

  const number = requireNumber(params.number, "github_pr", operation);

  if (operation === "get") {
    const response = await githubRequest(`/repos/${repo}/pulls/${number}`);
    const pullRequest = compactPr(response, true);
    const [files, comments, reviewComments, reviews] = await Promise.all([
      params.includeFiles ? getPullRequestFiles(repo, number, page, perPage) : undefined,
      params.includeComments ? getPullRequestIssueComments(repo, number, page, perPage) : undefined,
      params.includeReviewComments
        ? getPullRequestReviewComments(repo, number, page, perPage)
        : undefined,
      params.includeReviews ? getPullRequestReviews(repo, number, page, perPage) : undefined,
    ]);

    return toolResult(
      `${repo}#${pullRequest.number} ${pullRequest.state} ${oneLine(pullRequest.title, "")}`.trim(),
      {
        comments,
        commentsPage: params.includeComments ? page : undefined,
        files,
        pullRequest,
        repo,
        reviewComments,
        reviews,
        reviewsPage: params.includeReviews ? page : undefined,
      },
    );
  }

  if (operation === "files") {
    const files = await getPullRequestFiles(repo, number, page, perPage);

    return toolResult(
      `${repo}#${number} files page=${page} returned=${files.length}\n${files.map((file) => `${file.status} ${file.filename}`).join("\n")}`,
      { files, number, page, repo },
    );
  }

  if (operation === "diff") {
    const response = await githubRequest(`/repos/${repo}/pulls/${number}`, {
      headers: { Accept: "application/vnd.github.v3.diff" },
    });

    if (typeof response !== "string") {
      throw new Error("GitHub pull request diff returned an unexpected non-text response");
    }

    const limit = clampInteger(params.limit, DEFAULT_READ_LIMIT, 1, MAX_TEXT_LINE_LIMIT);
    const offset = clampInteger(params.offset, 1, 1, Number.MAX_SAFE_INTEGER);
    const path = `pulls/${number}.diff`;
    const window = buildTextReadWindow({
      content: response,
      lineNumbers: params.lineNumbers,
      limit,
      offset,
      path,
    });

    return toolResult(formatReadOutput({ path, repo, window }), {
      content: window.rendered,
      lines: lineDetails(window),
      number,
      repo,
    });
  }

  if (operation === "review_comments") {
    const reviewComments = await getPullRequestReviewComments(repo, number, page, perPage);

    return toolResult(
      `${repo}#${number} review comments page=${page} returned=${reviewComments.length}\n${reviewComments.map(formatReviewCommentLine).join("\n")}`,
      { number, page, repo, reviewComments },
    );
  }

  if (operation === "reviews") {
    const reviews = await getPullRequestReviews(repo, number, page, perPage);

    return toolResult(
      `${repo}#${number} reviews page=${page} returned=${reviews.length}\n${reviews.map(formatPullRequestReviewLine).join("\n")}`,
      { number, page, repo, reviews },
    );
  }

  if (operation === "comment") {
    if (!params.body?.trim()) {
      throw new Error("github_pr operation=comment requires body");
    }

    const response = await githubRequest(`/repos/${repo}/issues/${number}/comments`, {
      body: JSON.stringify({ body: params.body }),
      method: "POST",
    });
    const comment = compactIssueComment(response);

    return toolResult(`commented on pull request ${repo}#${number}\n${comment.url ?? ""}`.trim(), {
      comment,
      number,
      repo,
    });
  }

  if (operation === "review") {
    const payload: {
      body?: string;
      comments?: ReturnType<typeof createReviewCommentPayload>[];
      commit_id?: string;
      event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
    } = {
      event: params.reviewEvent ?? "COMMENT",
    };
    if (params.body?.trim()) {
      payload.body = params.body;
    }
    if (params.commitId?.trim()) {
      payload.commit_id = params.commitId.trim();
    }
    if (params.reviewComments?.length) {
      payload.comments = params.reviewComments.map((comment) =>
        createReviewCommentPayload(comment),
      );
    }

    const response = await githubRequest(`/repos/${repo}/pulls/${number}/reviews`, {
      body: JSON.stringify(payload),
      method: "POST",
    });
    const review = compactPullRequestReview(response);

    return toolResult(`reviewed pull request ${repo}#${number}\n${review.url ?? ""}`.trim(), {
      number,
      repo,
      review,
    });
  }

  if (operation === "close" || operation === "reopen") {
    const response = await githubRequest(`/repos/${repo}/pulls/${number}`, {
      body: JSON.stringify({ state: operation === "close" ? "closed" : "open" }),
      method: "PATCH",
    });
    const pullRequest = compactPr(response, true);

    return toolResult(
      `${operation} pull request ${repo}#${number}\n${pullRequest.url ?? ""}`.trim(),
      {
        pullRequest,
        repo,
      },
    );
  }

  const response = await githubRequest(`/repos/${repo}/pulls/${number}/merge`, {
    body: JSON.stringify({
      commit_message: params.commitMessage,
      commit_title: params.commitTitle,
      merge_method: params.mergeMethod ?? "merge",
      sha: params.sha,
    }),
    method: "PUT",
  });

  return toolResult(`merged pull request ${repo}#${number}\n${compactJson(response)}`, {
    number,
    repo,
    response: toJsonValue(response),
  });
}

async function getPullRequestFiles(repo: string, number: number, page: number, perPage: number) {
  const response = await githubRequest(
    appendQuery(`/repos/${repo}/pulls/${number}/files`, { page, per_page: perPage }),
  );

  return requireArrayResponse(response, "GitHub pull request files").map((file) =>
    compactPrFile(requireObjectResponse(file, "GitHub pull request file")),
  );
}

async function getPullRequestIssueComments(
  repo: string,
  number: number,
  page: number,
  perPage: number,
) {
  const response = await githubRequest(
    appendQuery(`/repos/${repo}/issues/${number}/comments`, { page, per_page: perPage }),
  );

  return requireArrayResponse(response, "GitHub pull request issue comments").map((comment) =>
    compactIssueComment(comment),
  );
}

async function getPullRequestReviewComments(
  repo: string,
  number: number,
  page: number,
  perPage: number,
) {
  const response = await githubRequest(
    appendQuery(`/repos/${repo}/pulls/${number}/comments`, { page, per_page: perPage }),
  );

  return requireArrayResponse(response, "GitHub pull request review comments").map((comment) =>
    compactReviewComment(comment),
  );
}

async function getPullRequestReviews(repo: string, number: number, page: number, perPage: number) {
  const response = await githubRequest(
    appendQuery(`/repos/${repo}/pulls/${number}/reviews`, { page, per_page: perPage }),
  );

  return requireArrayResponse(response, "GitHub pull request reviews").map((review) =>
    compactPullRequestReview(review),
  );
}

async function runActionsTool(params: {
  branch?: string;
  event?: string;
  jobId?: number;
  lineNumbers?: boolean;
  limit?: number;
  offset?: number;
  operation: ActionsOperation;
  page?: number;
  repo: string;
  runId?: number;
  status?: string;
  workflowId?: string;
}) {
  const repo = normalizeRepo(params.repo);
  const operation = params.operation;
  const perPage = clampInteger(params.limit, operation === "jobs" ? 100 : 20, 1, MAX_LIST_LIMIT);
  const page = clampInteger(params.page, 1, 1, 100);

  if (operation === "workflows") {
    const response = await githubRequest(
      appendQuery(`/repos/${repo}/actions/workflows`, { page, per_page: perPage }),
    );
    const body = requireObjectResponse(response, "GitHub Actions workflows");
    const total = requireNumberField(body.total_count, "GitHub Actions workflows total_count");
    const workflows = requireObjectArrayField(body, "workflows", "GitHub Actions workflows").map(
      (workflow) => compactWorkflow(workflow),
    );

    return toolResult(
      `${repo} workflows page=${page} total=${total} returned=${workflows.length}\n${workflows.map((workflow) => `${workflow.id} ${oneLine(workflow.name, "")}`).join("\n")}`,
      { page, repo, total, workflows },
    );
  }

  if (operation === "runs") {
    const endpoint = params.workflowId?.trim()
      ? `/repos/${repo}/actions/workflows/${encodeURIComponent(params.workflowId.trim())}/runs`
      : `/repos/${repo}/actions/runs`;
    const response = await githubRequest(
      appendQuery(endpoint, {
        branch: params.branch,
        event: params.event,
        page,
        per_page: perPage,
        status: params.status,
      }),
    );
    const body = requireObjectResponse(response, "GitHub Actions runs");
    const total = requireNumberField(body.total_count, "GitHub Actions runs total_count");
    const runs = requireObjectArrayField(body, "workflow_runs", "GitHub Actions runs").map((run) =>
      compactRun(run),
    );

    return toolResult(
      `${repo} runs page=${page} total=${total} returned=${runs.length}\n${runs.map(formatRunLine).join("\n")}`,
      { page, repo, runs, total },
    );
  }

  if (operation === "logs") {
    const jobId = requireNumber(params.jobId, "github_actions", operation);
    const response = await githubRequest(`/repos/${repo}/actions/jobs/${jobId}/logs`, {
      headers: { Accept: "text/plain" },
    });

    if (typeof response !== "string") {
      throw new Error("GitHub Actions job logs returned an unexpected non-text response");
    }

    const limit = clampInteger(params.limit, DEFAULT_READ_LIMIT, 1, MAX_TEXT_LINE_LIMIT);
    const offset = clampInteger(params.offset, 1, 1, Number.MAX_SAFE_INTEGER);
    const path = `actions/jobs/${jobId}.log`;
    const window = buildTextReadWindow({
      content: response,
      lineNumbers: params.lineNumbers,
      limit,
      offset,
      path,
    });

    return toolResult(formatReadOutput({ path, repo, window }), {
      content: window.rendered,
      jobId,
      lines: lineDetails(window),
      repo,
    });
  }

  const runId = requireNumber(params.runId, "github_actions", operation);

  if (operation === "run") {
    const response = await githubRequest(`/repos/${repo}/actions/runs/${runId}`);
    const run = compactRun(response);

    return toolResult(`${repo} run ${formatRunLine(run)}`, { repo, run });
  }

  if (operation === "jobs") {
    const response = await githubRequest(
      appendQuery(`/repos/${repo}/actions/runs/${runId}/jobs`, { page, per_page: perPage }),
    );
    const body = requireObjectResponse(response, "GitHub Actions jobs");
    const total = requireNumberField(body.total_count, "GitHub Actions jobs total_count");
    const jobs = requireObjectArrayField(body, "jobs", "GitHub Actions jobs").map((job) =>
      compactJob(job),
    );

    return toolResult(
      `${repo} run ${runId} jobs page=${page} total=${total} returned=${jobs.length}\n${jobs.map(formatJobLine).join("\n")}`,
      { jobs, page, repo, runId, total },
    );
  }

  const response = await githubRequest(`/repos/${repo}/actions/runs/${runId}/${operation}`, {
    method: "POST",
  });

  return toolResult(`${operation} requested for ${repo} run ${runId}`, {
    operation,
    repo,
    response: toJsonValue(response),
    runId,
  });
}

export const githubExtension: WebAuraExtension = {
  defaultEnabled: GITHUB_EXTENSION_DEFAULT_ENABLED,
  manifest: githubExtensionManifest,
  register(api) {
    api.registerTool({
      description: "GitHub auth status.",
      label: "GitHub Status",
      name: "github_status",
      parameters: Type.Object({}),
      async execute() {
        const authenticated = Boolean(await getGithubPersonalAccessToken());
        return toolResult(`authenticated=${authenticated} host=github.com`, {
          authenticated,
          host: "github.com",
        });
      },
    });

    api.registerTool({
      description:
        "GitHub repo metadata, README, directories, branches, releases, tags, or file lines.",
      label: "GitHub Repository",
      name: "github_repo",
      parameters: Type.Object({
        lineNumbers: Type.Optional(
          Type.Boolean({ description: "Prefix text read output with line numbers" }),
        ),
        limit: Type.Optional(
          Type.Integer({
            description: "Max rows for list operations, or max lines for text reads",
            maximum: MAX_TEXT_LINE_LIMIT,
            minimum: 1,
          }),
        ),
        offset: Type.Optional(
          Type.Integer({
            description: "Line number to start reading from for text reads (1-indexed)",
            minimum: 1,
          }),
        ),
        operation: RepoOperationSchema,
        page: Type.Optional(
          Type.Integer({ description: "Page number for paginated list operations", minimum: 1 }),
        ),
        path: Type.Optional(Type.String({ description: "Path for read/contents/blob display" })),
        recursive: Type.Optional(
          Type.Boolean({
            description: "Fetch tree recursively for operation=tree",
            default: false,
          }),
        ),
        ref: Type.Optional(
          Type.String({ description: "Git ref for read/contents/readme/tree operations" }),
        ),
        repo: Type.String({ description: "GitHub repository in owner/name format" }),
        sha: Type.Optional(
          Type.String({
            description: "Git blob sha for operation=blob, or tree sha for operation=tree",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const repo = normalizeRepo(params.repo);
        const operation = params.operation as RepoOperation;
        const perPage = clampInteger(params.limit, 20, 1, MAX_LIST_LIMIT);
        const page = clampInteger(params.page, 1, 1, 100);

        switch (operation) {
          case "branches": {
            const response = await githubRequest(
              appendQuery(`/repos/${repo}/branches`, { page, per_page: perPage }),
            );
            const branches = compactNameList(requireArrayResponse(response, "GitHub branches"));
            return toolResult(
              `${repo} branches page=${page} returned=${branches.length}\n${branches.map((branch) => branch.name).join("\n")}`,
              { branches, page, repo },
            );
          }
          case "blob": {
            const sha = params.sha?.trim();

            if (!sha) {
              throw new Error("sha is required for operation=blob");
            }

            const limit = clampInteger(params.limit, DEFAULT_READ_LIMIT, 1, MAX_TEXT_LINE_LIMIT);
            const offset = clampInteger(params.offset, 1, 1, Number.MAX_SAFE_INTEGER);
            return await readGitBlobResult({
              lineNumbers: params.lineNumbers,
              limit,
              offset,
              path: params.path?.trim() || `blobs/${sha}`,
              ref: params.ref,
              repo,
              sha,
            });
          }
          case "contents": {
            const response = await githubRequest(
              appendQuery(`/repos/${repo}/contents/${encodeRepoPath(params.path)}`, {
                ref: params.ref,
              }),
            );
            const path = params.path?.trim() || "/";

            if (!Array.isArray(response)) {
              return await readRepositoryContentFile({
                defaultLimit: DEFAULT_READ_LIMIT,
                file: compactContentFile(response, "GitHub contents file"),
                limit: params.limit,
                lineNumbers: params.lineNumbers,
                offset: params.offset,
                pathLabel: path,
                ref: params.ref,
                repo,
              });
            }

            const contents = compactDirectory(response);
            return toolResult(
              `${repo} ${path} ${contents.kind} entries=${contents.entries.length}\n${formatDirectory(contents.entries).join("\n")}`,
              { ...contents, path, ref: params.ref, repo },
            );
          }
          case "get": {
            const response = await githubRequest(`/repos/${repo}`);
            const compact = compactRepo(response);
            return toolResult(formatRepo(compact), compact);
          }
          case "read": {
            if (!params.path?.trim()) {
              throw new Error("path is required for operation=read");
            }

            const response = await githubRequest(
              appendQuery(`/repos/${repo}/contents/${encodeRepoPath(params.path)}`, {
                ref: params.ref,
              }),
            );

            if (Array.isArray(response)) {
              throw new Error("Path points to a directory; use operation=contents instead");
            }

            return await readRepositoryContentFile({
              defaultLimit: DEFAULT_READ_LIMIT,
              file: compactContentFile(response, "GitHub contents file"),
              limit: params.limit,
              lineNumbers: params.lineNumbers,
              offset: params.offset,
              pathLabel: params.path,
              ref: params.ref,
              repo,
            });
          }
          case "readme": {
            const response = await githubRequest(
              appendQuery(`/repos/${repo}/readme`, { ref: params.ref }),
            );
            const readme = compactContentFile(response, "GitHub README");
            return await readRepositoryContentFile({
              defaultLimit: DEFAULT_README_LIMIT,
              file: readme,
              limit: params.limit,
              lineNumbers: params.lineNumbers,
              offset: params.offset,
              pathLabel: readme.path ?? readme.name ?? "README",
              ref: params.ref,
              repo,
            });
          }
          case "releases": {
            const response = await githubRequest(
              appendQuery(`/repos/${repo}/releases`, { page, per_page: perPage }),
            );
            const releases = requireArrayResponse(response, "GitHub releases").map((release) => {
              const item = requireObjectResponse(release, "GitHub release");
              return {
                draft: requireBooleanField(item.draft, "GitHub release draft"),
                name: optionalStringField(item.name, "GitHub release name"),
                prerelease: requireBooleanField(item.prerelease, "GitHub release prerelease"),
                publishedAt: optionalStringField(item.published_at, "GitHub release published_at"),
                tag: requireStringField(item.tag_name, "GitHub release tag_name"),
                url: optionalStringField(item.html_url, "GitHub release html_url"),
              };
            });
            return toolResult(
              `${repo} releases page=${page} returned=${releases.length}\n${releases.map((release) => `${release.tag}${release.name ? ` ${release.name}` : ""}`).join("\n")}`,
              { page, releases, repo },
            );
          }
          case "tags": {
            const response = await githubRequest(
              appendQuery(`/repos/${repo}/tags`, { page, per_page: perPage }),
            );
            const tags = compactNameList(requireArrayResponse(response, "GitHub tags"));
            return toolResult(
              `${repo} tags page=${page} returned=${tags.length}\n${tags.map((tag) => tag.name).join("\n")}`,
              { page, repo, tags },
            );
          }
          case "tree": {
            const treeTarget = params.sha?.trim() || params.ref?.trim() || "HEAD";
            const recursive = Boolean(params.recursive);
            const response = await githubRequest(
              appendQuery(`/repos/${repo}/git/trees/${encodeURIComponent(treeTarget)}`, {
                recursive: recursive ? 1 : undefined,
              }),
            );
            const body = requireObjectResponse(response, "GitHub tree");
            const rawEntries = requireObjectArrayField(body, "tree", "GitHub tree");
            const truncated = body.truncated;

            if (typeof truncated !== "boolean") {
              throw new Error("GitHub tree response field truncated was not a boolean");
            }

            if (rawEntries.length === 0) {
              return toolResult(
                `${repo} tree target=${treeTarget} recursive=${recursive} entries=0 truncated=${truncated}`,
                {
                  entries: [],
                  recursive,
                  ref: params.ref,
                  repo,
                  target: treeTarget,
                  totalEntries: 0,
                  truncated,
                },
              );
            }

            const limit = clampInteger(params.limit, DEFAULT_README_LIMIT, 1, MAX_TEXT_LINE_LIMIT);
            const offset = clampInteger(params.offset, 1, 1, Number.MAX_SAFE_INTEGER);
            const startIndex = offset - 1;
            const selectedEntries = rawEntries
              .slice(startIndex, startIndex + limit)
              .map((entry) => compactTreeEntry(entry));
            const window = buildTextReadWindowFromSelectedLines({
              lineNumbers: params.lineNumbers,
              limit,
              offset,
              path: `tree/${treeTarget}`,
              selectedLines: selectedEntries.map(formatTreeLine),
              totalLines: rawEntries.length,
            });
            const shownEntries = selectedEntries.slice(0, window.count);

            return toolResult(
              `${repo} tree target=${treeTarget} recursive=${recursive} entries=${rawEntries.length} truncated=${truncated}\n${window.rendered}`,
              {
                entries: shownEntries,
                lines: lineDetails(window),
                recursive,
                ref: params.ref,
                repo,
                target: treeTarget,
                totalEntries: rawEntries.length,
                truncated,
              },
            );
          }
        }
      },
    });

    api.registerTool({
      description: "List, inspect, create, comment on, close, or reopen GitHub issues.",
      label: "GitHub Issues",
      name: "github_issue",
      parameters: Type.Object({
        assignee: Type.Optional(
          Type.String({ description: "Single assignee login for list/create" }),
        ),
        body: Type.Optional(Type.String({ description: "Issue body or comment body" })),
        direction: Type.Optional(DirectionSchema),
        includeComments: Type.Optional(
          Type.Boolean({ description: "Include comments for get", default: false }),
        ),
        labels: Type.Optional(
          Type.Array(Type.String({ description: "Label name" }), { description: "Label names" }),
        ),
        limit: Type.Optional(
          Type.Integer({ description: "Max rows for list", maximum: MAX_LIST_LIMIT, minimum: 1 }),
        ),
        number: Type.Optional(Type.Integer({ description: "Issue number", minimum: 1 })),
        operation: IssueOperationSchema,
        page: Type.Optional(
          Type.Integer({ description: "Page number for list/search", minimum: 1 }),
        ),
        repo: Type.String({ description: "GitHub repository in owner/name format" }),
        search: Type.Optional(
          Type.String({ description: "Search query for list via /search/issues" }),
        ),
        sort: Type.Optional(IssueSortSchema),
        state: Type.Optional(IssueStateSchema),
        title: Type.Optional(Type.String({ description: "Issue title for create" })),
      }),
      async execute(_toolCallId, params) {
        return await runIssueTool(params as Parameters<typeof runIssueTool>[0]);
      },
    });

    api.registerTool({
      description:
        "List, inspect, create, review, comment on, close, reopen, or merge GitHub pull requests.",
      label: "GitHub Pull Requests",
      name: "github_pr",
      parameters: Type.Object({
        base: Type.Optional(Type.String({ description: "Base branch" })),
        body: Type.Optional(Type.String({ description: "PR body, comment body, or review body" })),
        commitId: Type.Optional(
          Type.String({ description: "Commit SHA to review for operation=review" }),
        ),
        commitMessage: Type.Optional(Type.String({ description: "Merge commit message" })),
        commitTitle: Type.Optional(Type.String({ description: "Merge commit title" })),
        direction: Type.Optional(DirectionSchema),
        draft: Type.Optional(Type.Boolean({ description: "Create as draft", default: false })),
        head: Type.Optional(Type.String({ description: "Head branch" })),
        includeComments: Type.Optional(
          Type.Boolean({
            description: "Include regular PR conversation comments for get",
            default: false,
          }),
        ),
        includeFiles: Type.Optional(
          Type.Boolean({ description: "Include changed files for get", default: false }),
        ),
        includeReviewComments: Type.Optional(
          Type.Boolean({
            description: "Include line-level review comments for get",
            default: false,
          }),
        ),
        includeReviews: Type.Optional(
          Type.Boolean({
            description: "Include PR review approvals/requests for get",
            default: false,
          }),
        ),
        lineNumbers: Type.Optional(
          Type.Boolean({ description: "Prefix diff output with line numbers" }),
        ),
        limit: Type.Optional(
          Type.Integer({
            description: "Max rows for list, or max lines for diff",
            maximum: MAX_TEXT_LINE_LIMIT,
            minimum: 1,
          }),
        ),
        offset: Type.Optional(
          Type.Integer({ description: "Line number to start reading from for diff", minimum: 1 }),
        ),
        mergeMethod: Type.Optional(MergeMethodSchema),
        number: Type.Optional(Type.Integer({ description: "Pull request number", minimum: 1 })),
        operation: PrOperationSchema,
        page: Type.Optional(
          Type.Integer({ description: "Page number for list operations", minimum: 1 }),
        ),
        repo: Type.String({ description: "GitHub repository in owner/name format" }),
        reviewComments: Type.Optional(
          Type.Array(CreateReviewCommentSchema, {
            description: "Line-level comments to submit with operation=review",
          }),
        ),
        reviewEvent: Type.Optional(ReviewEventSchema),
        sha: Type.Optional(
          Type.String({ description: "Expected PR head SHA for operation=merge" }),
        ),
        sort: Type.Optional(PrSortSchema),
        state: Type.Optional(IssueStateSchema),
        title: Type.Optional(Type.String({ description: "PR title for create" })),
      }),
      async execute(_toolCallId, params) {
        return await runPrTool(params as Parameters<typeof runPrTool>[0]);
      },
    });

    api.registerTool({
      description:
        "Inspect GitHub Actions workflows, workflow runs, jobs, reruns, and cancellations.",
      label: "GitHub Actions",
      name: "github_actions",
      parameters: Type.Object({
        branch: Type.Optional(Type.String({ description: "Branch filter for runs" })),
        event: Type.Optional(Type.String({ description: "Event filter for runs" })),
        jobId: Type.Optional(Type.Integer({ description: "Workflow job id for logs", minimum: 1 })),
        lineNumbers: Type.Optional(
          Type.Boolean({ description: "Prefix log output with line numbers" }),
        ),
        limit: Type.Optional(
          Type.Integer({
            description: "Max rows for list operations, or max lines for logs",
            maximum: MAX_TEXT_LINE_LIMIT,
            minimum: 1,
          }),
        ),
        offset: Type.Optional(
          Type.Integer({ description: "Line number to start reading from for logs", minimum: 1 }),
        ),
        operation: ActionsOperationSchema,
        page: Type.Optional(
          Type.Integer({ description: "Page number for list operations", minimum: 1 }),
        ),
        repo: Type.String({ description: "GitHub repository in owner/name format" }),
        runId: Type.Optional(Type.Integer({ description: "Workflow run id", minimum: 1 })),
        status: Type.Optional(Type.String({ description: "Status filter for runs" })),
        workflowId: Type.Optional(
          Type.String({ description: "Workflow id or file name for runs" }),
        ),
      }),
      async execute(_toolCallId, params) {
        return await runActionsTool(params as Parameters<typeof runActionsTool>[0]);
      },
    });

    api.registerTool({
      description: "GitHub search for repos, users, issues, PRs, or code.",
      label: "GitHub Search",
      name: "github_search",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Integer({ description: "Max rows", maximum: MAX_LIST_LIMIT, minimum: 1 }),
        ),
        page: Type.Optional(
          Type.Integer({ description: "Page number for paginated search results", minimum: 1 }),
        ),
        query: Type.String({
          description:
            "Search query. Supports GitHub qualifiers like in:file, language:ts, path:, filename:, extension:, size:, and user/org/repo scopes.",
        }),
        repo: Type.Optional(Type.String({ description: "Optional owner/name repo scope" })),
        type: SearchTypeSchema,
      }),
      async execute(_toolCallId, params) {
        const type = params.type as SearchType;
        const limit = clampInteger(params.limit, 10, 1, MAX_LIST_LIMIT);
        const page = clampInteger(params.page, 1, 1, 100);

        if (type === "code" && !params.repo && !hasCodeSearchScope(params.query)) {
          throw new Error(
            "github_search type=code requires repo parameter or a repo:/org:/user: qualifier in query",
          );
        }

        const scopedRepo = params.repo ? ` repo:${normalizeRepo(params.repo)}` : "";
        const typeQualifier = type === "issues" ? " is:issue" : type === "prs" ? " is:pr" : "";
        const query = `${params.query}${scopedRepo}${typeQualifier}`.trim();
        const endpoint = getSearchEndpoint(type);
        const response = await githubRequest(
          appendQuery(`/search/${endpoint}`, {
            page,
            per_page: limit,
            q: query,
          }),
          type === "code" ? { headers: { Accept: "application/vnd.github.text-match+json" } } : {},
        );
        const compact = compactSearchResponse(type, response);
        const lines = compact.items.map((item) => formatSearchItem(type, item));

        return toolResult(
          `${type} query=${JSON.stringify(query)} page=${page} total=${compact.total} returned=${compact.returned} incomplete=${compact.incomplete}\n${lines.join("\n")}`,
          {
            endpoint: `/search/${endpoint}`,
            page,
            query,
            type,
            ...compact,
          },
        );
      },
    });

    api.registerTool({
      description: "Raw GitHub REST/GraphQL. Mutations require confirmMutation=true.",
      label: "GitHub API",
      name: "github_api",
      parameters: Type.Object({
        body: Type.Optional(Type.Any({ description: "REST body as native JSON" })),
        confirmMutation: Type.Optional(Type.Boolean()),
        graphqlQuery: Type.Optional(Type.String()),
        method: Type.Optional(HttpMethod),
        operation: Type.Union([Type.Literal("rest"), Type.Literal("graphql")]),
        path: Type.Optional(Type.String()),
        query: Type.Optional(
          Type.Record(Type.String(), QueryValueSchema, {
            description: "REST query params as native JSON object",
          }),
        ),
        variables: Type.Optional(Type.Any({ description: "GraphQL variables as native JSON" })),
      }),
      async execute(_toolCallId, params) {
        let response: unknown;
        let request: Record<string, JsonValue>;

        if (params.operation === "graphql") {
          const query = params.graphqlQuery?.trim();

          if (!query) {
            throw new Error("graphqlQuery is required for GraphQL requests");
          }

          assertMutationAllowed({
            confirmMutation: params.confirmMutation,
            isMutation: isGraphqlMutation(query),
          });
          response = await githubRequest("/graphql", {
            body: JSON.stringify({
              query,
              variables: params.variables ?? {},
            }),
            method: "POST",
          });
          request = {
            method: "POST",
            operation: "graphql",
            path: "/graphql",
          };
        } else {
          const path = params.path?.trim();

          if (!path) {
            throw new Error("path is required for REST requests");
          }

          const query = queryRecord(params.query);
          const body = params.body;
          const method = params.method ?? (body === undefined ? "GET" : "POST");
          assertMutationAllowed({
            confirmMutation: params.confirmMutation,
            isMutation: method !== "GET",
          });
          const resolvedPath = query ? appendQuery(path, query) : path;
          response = await githubRequest(resolvedPath, {
            body: body === undefined ? undefined : JSON.stringify(body),
            method,
          });
          request = {
            method,
            operation: "rest",
            path: resolvedPath,
          };
        }

        return toolResult(`${request.method} ${request.path}\n${compactJson(response)}`, {
          request,
          responsePreview: toJsonValue(compactJson(response)),
        });
      },
    });
  },
};
