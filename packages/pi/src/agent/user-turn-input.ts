import type { ChatAttachment, UserMessage, UserContent } from "@gitaura/pi/types/chat";

export interface UserTurnFile {
  filename?: string;
  mediaType?: string;
  size?: number;
  url: string;
}

export interface UserTurnInput {
  files?: UserTurnFile[];
  text: string;
}

export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;

export const SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS = [
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".log",
  ".lua",
  ".md",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
] as const;

export const SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS = [
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
] as const;

export const SUPPORTED_DOCUMENT_ATTACHMENT_EXTENSIONS = [
  ".docx",
  ".pdf",
  ".pptx",
  ".xls",
  ".xlsx",
] as const;

export const SUPPORTED_ATTACHMENT_MIME_TYPES = [
  "image/*",
  "text/*",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const SUPPORTED_ATTACHMENT_ACCEPT = [
  ...SUPPORTED_ATTACHMENT_MIME_TYPES,
  ...SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS,
  ...SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS,
  ...SUPPORTED_DOCUMENT_ATTACHMENT_EXTENSIONS,
].join(",");

export const SUPPORTED_ATTACHMENT_PICKER_TYPES = [
  {
    accept: {
      "image/*": SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS,
    },
    description: "Images",
  },
  {
    accept: {
      "text/*": SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS,
    },
    description: "Text and source files",
  },
  {
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    description: "Documents",
  },
] as const;

const TEXT_EXTENSIONS = new Set<string>(SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS);

const EXCEL_MIME_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

type ProcessedAttachment = {
  attachment: ChatAttachment;
  content?: UserContent;
};

type LoadedAttachmentData = {
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
  size: number;
};

function trimText(text: string): string {
  return text.trim();
}

export function normalizeUserTurnInput(input: string | UserTurnInput): UserTurnInput {
  if (typeof input === "string") {
    return {
      text: input,
    };
  }

  return {
    files: input.files,
    text: input.text,
  };
}

export function hasUserTurnInputContent(input: string | UserTurnInput): boolean {
  const normalized = normalizeUserTurnInput(input);
  return trimText(normalized.text).length > 0 || (normalized.files?.length ?? 0) > 0;
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function inferMediaType(file: UserTurnFile, fileName: string): string {
  const mediaType = file.mediaType?.split(";")[0]?.trim();

  if (mediaType && mediaType !== "application/octet-stream") {
    return mediaType;
  }

  switch (getFileExtension(fileName)) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return TEXT_EXTENSIONS.has(getFileExtension(fileName))
        ? "text/plain"
        : "application/octet-stream";
  }
}

function resolveMediaType(
  rawMediaType: string | undefined,
  file: UserTurnFile,
  fileName: string,
): string {
  const inferred = inferMediaType(file, fileName);
  const normalized = rawMediaType?.split(";")[0]?.trim();

  if (!normalized || normalized === "application/octet-stream") {
    return inferred;
  }

  return normalized;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function dataUrlToBytes(url: string): { bytes: Uint8Array; mediaType?: string } | undefined {
  const match = url.match(/^data:([^,]*),(.*)$/s);

  if (!match) {
    return undefined;
  }

  const metadata = match[1] ?? "";
  const encoded = match[2] ?? "";
  const mediaType = metadata.split(";")[0] || undefined;
  const isBase64 = metadata.split(";").some((part) => part.toLowerCase() === "base64");
  const binary = isBase64 ? decodeBase64(encoded) : decodeURIComponent(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return { bytes, mediaType };
}

function decodeBase64(encoded: string): string {
  return atob(encoded);
}

async function loadAttachmentData(file: UserTurnFile): Promise<LoadedAttachmentData> {
  const fileName = file.filename?.trim() || "attachment";
  const fromDataUrl = dataUrlToBytes(file.url);

  if (fromDataUrl) {
    const mediaType = resolveMediaType(fromDataUrl.mediaType, file, fileName);
    const size = file.size ?? fromDataUrl.bytes.byteLength;
    return {
      bytes: fromDataUrl.bytes,
      fileName,
      mediaType,
      size,
    };
  }

  const response = await fetch(file.url);

  if (!response.ok) {
    throw new Error(
      `Failed to load attachment ${fileName}: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const mediaType = resolveMediaType(
    response.headers.get("content-type") ?? undefined,
    file,
    fileName,
  );

  return {
    bytes,
    fileName,
    mediaType,
    size: file.size ?? bytes.byteLength,
  };
}

function assertSupportedSize(data: LoadedAttachmentData): void {
  if (data.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(
      `Attachment ${data.fileName} is too large (${(data.size / 1024 / 1024).toFixed(1)}MB). Maximum supported size is 50MB.`,
    );
  }
}

function isTextFile(mediaType: string, fileName: string): boolean {
  return mediaType.startsWith("text/") || TEXT_EXTENSIONS.has(getFileExtension(fileName));
}

function isPdf(mediaType: string, fileName: string): boolean {
  return mediaType === "application/pdf" || getFileExtension(fileName) === ".pdf";
}

function isDocx(mediaType: string, fileName: string): boolean {
  return (
    mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    getFileExtension(fileName) === ".docx"
  );
}

function isPptx(mediaType: string, fileName: string): boolean {
  return (
    mediaType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    getFileExtension(fileName) === ".pptx"
  );
}

function isExcel(mediaType: string, fileName: string): boolean {
  const extension = getFileExtension(fileName);
  return EXCEL_MIME_TYPES.has(mediaType) || extension === ".xls" || extension === ".xlsx";
}

async function extractTextFromPdf(bytes: Uint8Array, fileName: string): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

  try {
    let extractedText = `<pdf filename="${escapeAttribute(fileName)}">`;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .filter((text) => text.trim())
        .join(" ");
      extractedText += `\n<page number="${String(pageNumber)}">\n${pageText}\n</page>`;
    }

    return `${extractedText}\n</pdf>`;
  } finally {
    await pdf.destroy();
  }
}

async function extractTextFromDocx(bytes: Uint8Array, fileName: string): Promise<string> {
  const { parseAsync } = await import("docx-preview");
  const wordDoc = await parseAsync(bytesToArrayBuffer(bytes));
  const body = wordDoc.documentPart?.body;
  const texts: string[] = [];

  if (body?.children) {
    for (const element of body.children) {
      const text = extractTextFromDocxElement(element);
      if (text) {
        texts.push(text);
      }
    }
  }

  return `<docx filename="${escapeAttribute(fileName)}">\n<page number="1">\n${texts.join("\n")}\n</page>\n</docx>`;
}

function extractTextFromDocxElement(element: unknown): string {
  if (!element || typeof element !== "object") {
    return "";
  }

  const node = element as { children?: unknown[]; text?: string; type?: string };
  const type = node.type?.toLowerCase() ?? "";

  if (type === "text") {
    return node.text?.trim() ?? "";
  }

  if (type === "paragraph" && node.children) {
    return node.children.map(extractTextFromDocxElement).filter(Boolean).join("").trim();
  }

  if (type === "table" && node.children) {
    const rows = node.children.map(extractTextFromDocxElement).filter(Boolean);
    return rows.length > 0 ? `\n[Table]\n${rows.join("\n")}\n[/Table]\n` : "";
  }

  if (type === "tablerow" && node.children) {
    return node.children.map(extractTextFromDocxElement).filter(Boolean).join(" | ").trim();
  }

  if (type === "tablecell" && node.children) {
    return node.children.map(extractTextFromDocxElement).filter(Boolean).join(" ").trim();
  }

  return node.children?.map(extractTextFromDocxElement).filter(Boolean).join(" ").trim() ?? "";
}

async function extractTextFromPptx(bytes: Uint8Array, fileName: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  let extractedText = `<pptx filename="${escapeAttribute(fileName)}">`;
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => extractTrailingNumber(left) - extractTrailingNumber(right));

  for (const [index, path] of slideFiles.entries()) {
    const file = zip.file(path);
    if (!file) {
      continue;
    }

    const slideXml = await file.async("text");
    const texts = extractXmlTextTags(slideXml);

    if (texts.length > 0) {
      extractedText += `\n<slide number="${String(index + 1)}">\n${texts.join("\n")}\n</slide>`;
    }
  }

  const notesFiles = Object.keys(zip.files)
    .filter((name) => /ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
    .sort((left, right) => extractTrailingNumber(left) - extractTrailingNumber(right));

  if (notesFiles.length > 0) {
    extractedText += "\n<notes>";
    for (const path of notesFiles) {
      const file = zip.file(path);
      if (!file) {
        continue;
      }

      const noteXml = await file.async("text");
      const texts = extractXmlTextTags(noteXml);
      if (texts.length > 0) {
        extractedText += `\n[Slide ${String(extractTrailingNumber(path))} notes]: ${texts.join(" ")}`;
      }
    }
    extractedText += "\n</notes>";
  }

  return `${extractedText}\n</pptx>`;
}

async function extractTextFromExcel(bytes: Uint8Array, fileName: string): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(bytes, { type: "array" });
  let extractedText = `<excel filename="${escapeAttribute(fileName)}">`;

  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      continue;
    }

    const csvText = XLSX.utils.sheet_to_csv(worksheet);
    extractedText += `\n<sheet name="${escapeAttribute(sheetName)}" index="${String(index + 1)}">\n${csvText}\n</sheet>`;
  }

  return `${extractedText}\n</excel>`;
}

function extractXmlTextTags(xml: string): string[] {
  return [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)]
    .map((match) => decodeXmlEntities(match[1] ?? ""))
    .map((text) => text.trim())
    .filter(Boolean);
}

function extractTrailingNumber(value: string): number {
  return Number.parseInt(value.match(/(\d+)\.xml$/)?.[1] ?? "0", 10);
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function escapeAttribute(value: string): string {
  return decodeXmlEntities(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatDocumentText(fileName: string, extractedText: string): string {
  return `\n\n[Document: ${fileName}]\n${extractedText.trim()}`;
}

async function processAttachment(file: UserTurnFile, index: number): Promise<ProcessedAttachment> {
  const data = await loadAttachmentData(file);
  assertSupportedSize(data);

  const id = `${data.fileName}-${String(index)}-${String(data.size)}`;

  if (data.mediaType.startsWith("image/")) {
    return {
      attachment: {
        fileName: data.fileName,
        id,
        mediaType: data.mediaType,
        size: data.size,
        type: "image",
      },
      content: {
        data: bytesToBase64(data.bytes),
        mimeType: data.mediaType,
        type: "image",
      },
    };
  }

  let extractedText: string | undefined;

  if (isTextFile(data.mediaType, data.fileName)) {
    extractedText = new TextDecoder().decode(data.bytes);
  } else if (isPdf(data.mediaType, data.fileName)) {
    extractedText = await extractTextFromPdf(data.bytes, data.fileName);
  } else if (isDocx(data.mediaType, data.fileName)) {
    extractedText = await extractTextFromDocx(data.bytes, data.fileName);
  } else if (isPptx(data.mediaType, data.fileName)) {
    extractedText = await extractTextFromPptx(data.bytes, data.fileName);
  } else if (isExcel(data.mediaType, data.fileName)) {
    extractedText = await extractTextFromExcel(data.bytes, data.fileName);
  }

  if (!extractedText?.trim()) {
    throw new Error(
      `Unsupported attachment ${data.fileName}. Supported files are images, text files, PDF, DOCX, PPTX, XLS, and XLSX.`,
    );
  }

  return {
    attachment: {
      fileName: data.fileName,
      id,
      mediaType: data.mediaType,
      size: data.size,
      type: "document",
    },
    content: {
      text: formatDocumentText(data.fileName, extractedText),
      type: "text",
    },
  };
}

function formatAttachmentSummary(attachments: readonly ChatAttachment[]): string {
  const names = attachments.map((attachment) => attachment.fileName);

  if (names.length === 0) {
    return "";
  }

  if (names.length <= 3) {
    return `Attached ${names.join(", ")}`;
  }

  return `Attached ${names.slice(0, 3).join(", ")} and ${String(names.length - 3)} more`;
}

export async function createUserMessageFromTurnInput(params: {
  id: string;
  input: string | UserTurnInput;
  timestamp: number;
}): Promise<UserMessage | undefined> {
  const input = normalizeUserTurnInput(params.input);
  const text = trimText(input.text);
  const files = input.files ?? [];

  if (!text && files.length === 0) {
    return undefined;
  }

  if (files.length === 0) {
    return {
      content: text,
      id: params.id,
      role: "user",
      timestamp: params.timestamp,
    };
  }

  const content: UserContent[] = [];

  if (text) {
    content.push({ text, type: "text" });
  }

  const attachments: ChatAttachment[] = [];
  const processedAttachments = await Promise.all(
    files.map((file, index) => processAttachment(file, index)),
  );

  for (const processed of processedAttachments) {
    if (processed.content) {
      processed.attachment.contentPartIndex = content.length;
      content.push(processed.content);
    }
    attachments.push(processed.attachment);
  }

  return {
    attachments,
    content,
    displayText: text || formatAttachmentSummary(attachments),
    id: params.id,
    role: "user",
    timestamp: params.timestamp,
  };
}
