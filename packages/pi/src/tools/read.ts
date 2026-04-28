import { Type, type Static } from "typebox";
import type { ResolvedRepoSource } from "@webaura/db";
import {
  GitHubApiError,
  readGitHubErrorMessage,
  toGitHubApiError,
} from "@webaura/pi/repo/github-errors";
import { githubApiFetch } from "@webaura/pi/repo/github-fetch";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type TruncationResult,
} from "@webaura/pi/tools/truncate";
import type { AppToolDefinition } from "@webaura/pi/tools/types";

const MAX_SUPPORTED_FILE_BYTES = 1_000_000;

const readSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of lines to read",
      minimum: 1,
    }),
  ),
  offset: Type.Optional(
    Type.Number({
      description: "1-indexed line number to start reading from",
      minimum: 1,
    }),
  ),
  path: Type.String({
    description: "Path to the file to read from the active repository",
  }),
});

export type ReadToolParams = Static<typeof readSchema>;

export interface ReadToolDetails {
  path: string;
  resolvedPath: string;
  truncation?: TruncationResult;
}

type GitHubContentResponse = {
  content?: string;
  encoding?: string;
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "dir" | "file" | "submodule" | "symlink";
};

function normalizePath(path: string): string {
  const trimmed = path.trim();

  if (!trimmed || trimmed === "/" || trimmed === ".") {
    return "";
  }

  const normalizedSegments: string[] = [];

  for (const segment of trimmed.split("/")) {
    const next = segment.trim();

    if (!next || next === ".") {
      continue;
    }

    if (next === "..") {
      normalizedSegments.pop();
      continue;
    }

    normalizedSegments.push(next);
  }

  return normalizedSegments.join("/");
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getSourceRef(source: ResolvedRepoSource): string {
  if (source.resolvedRef.kind === "commit") {
    return source.resolvedRef.sha;
  }

  return source.resolvedRef.name;
}

function buildContentsPath(source: ResolvedRepoSource, path: string): string {
  const owner = encodeURIComponent(source.owner);
  const repo = encodeURIComponent(source.repo);
  const normalizedPath = normalizePath(path);
  const encodedPath = encodePath(normalizedPath);
  const ref = encodeURIComponent(getSourceRef(source));
  const pathSuffix = encodedPath ? `/${encodedPath}` : "";

  return `/repos/${owner}/${repo}/contents${pathSuffix}?ref=${ref}`;
}

function directoryError(path: string): GitHubApiError {
  return new GitHubApiError({
    code: "EISDIR",
    isRetryable: false,
    kind: "unsupported",
    message: `Is a directory: ${path}`,
    path,
  });
}

function unsupportedFileError(path: string, size: number): GitHubApiError {
  return new GitHubApiError({
    code: "EFBIG",
    githubMessage: `File size: ${size} bytes`,
    isRetryable: false,
    kind: "unsupported",
    message: `File is too large for WebAura (${size} bytes): ${path}`,
    path,
  });
}

function decodeBase64(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(cleaned), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isProbablyBinary(content: string): boolean {
  return content.includes("\u0000");
}

async function readRepoFile(source: ResolvedRepoSource, path: string, signal?: AbortSignal) {
  const resolvedPath = normalizePath(path);
  const pathForError = resolvedPath ? `/${resolvedPath}` : "/";
  const response = await githubApiFetch(buildContentsPath(source, resolvedPath), {
    access: "repo",
    signal,
  });

  if (!response.ok) {
    throw toGitHubApiError(response, pathForError, await readGitHubErrorMessage(response));
  }

  const payload = (await response.json()) as GitHubContentResponse | GitHubContentResponse[];
  if (Array.isArray(payload) || (payload.type !== "file" && payload.type !== "symlink")) {
    throw directoryError(pathForError);
  }

  if (payload.size > MAX_SUPPORTED_FILE_BYTES) {
    throw unsupportedFileError(pathForError, payload.size);
  }

  if (!payload.content || payload.encoding !== "base64") {
    throw new GitHubApiError({
      code: "ENOTSUP",
      isRetryable: false,
      kind: "unsupported",
      message: `GitHub did not return inline text content for: ${pathForError}`,
      path: pathForError,
    });
  }

  return {
    path: payload.path,
    resolvedPath: pathForError,
    text: decodeBase64(payload.content),
  };
}

export function createReadTool(
  source: ResolvedRepoSource,
  onRepoError?: (error: unknown) => void | Promise<void>,
): AppToolDefinition<typeof readSchema, ReadToolDetails> {
  return {
    description:
      "Read text file contents from the active GitHub repository. Use offset and limit for large files. " +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${Math.floor(DEFAULT_MAX_BYTES / 1024)}KB.`,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error("Read aborted");
      }

      let file: Awaited<ReturnType<typeof readRepoFile>>;

      try {
        file = await readRepoFile(source, params.path, signal);
      } catch (error) {
        if (onRepoError) {
          await onRepoError(error);
        }

        throw error;
      }

      if (isProbablyBinary(file.text)) {
        throw new GitHubApiError({
          code: "ENOTSUP",
          isRetryable: false,
          kind: "unsupported",
          message: "Binary files are not supported by read.",
          path: file.resolvedPath,
        });
      }

      const allLines = file.text.split("\n");
      const start = params.offset ? Math.max(0, params.offset - 1) : 0;

      if (start >= allLines.length) {
        throw new Error(
          `Offset ${params.offset} is beyond the end of the file (${allLines.length} lines total)`,
        );
      }

      const selectedLines =
        params.limit !== undefined
          ? allLines.slice(start, start + params.limit)
          : allLines.slice(start);
      const selectedContent = selectedLines.join("\n");
      const truncation = truncateHead(selectedContent);
      let output = truncation.content;

      if (truncation.firstLineExceedsLimit) {
        output =
          `Line ${start + 1} exceeds the ${Math.floor(DEFAULT_MAX_BYTES / 1024)}KB read limit. ` +
          "Use offset and limit to request a narrower range.";
      } else if (truncation.truncated) {
        const endLine = start + truncation.outputLines;
        output += `\n\n[Showing lines ${start + 1}-${endLine}. Use offset=${endLine + 1} to continue.]`;
      } else if (params.limit !== undefined && start + selectedLines.length < allLines.length) {
        output += `\n\n[More lines remain. Use offset=${start + selectedLines.length + 1} to continue.]`;
      }

      return {
        content: [{ text: output, type: "text" }],
        details: {
          path: params.path,
          resolvedPath: file.resolvedPath,
          truncation: truncation.truncated ? truncation : undefined,
        },
      };
    },
    label: "Read",
    name: "read",
    parameters: readSchema,
  };
}
