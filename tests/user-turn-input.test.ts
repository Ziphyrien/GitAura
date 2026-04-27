import { describe, expect, it } from "vite-plus/test";
import { createUserMessageFromTurnInput } from "@/agent/user-turn-input";
import { getUserText } from "@/lib/chat-adapter";

function dataUrl(mediaType: string, value: string): string {
  return `data:${mediaType};base64,${btoa(value)}`;
}

describe("user turn attachment input", () => {
  it("turns text documents into hidden LLM text blocks with attachment metadata", async () => {
    const message = await createUserMessageFromTurnInput({
      id: "user-1",
      input: {
        files: [
          {
            filename: "notes.md",
            mediaType: "text/markdown",
            size: 7,
            url: dataUrl("text/markdown", "# Hello"),
          },
        ],
        text: "summarize this",
      },
      timestamp: 123,
    });

    expect(message).toEqual(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            contentPartIndex: 1,
            fileName: "notes.md",
            mediaType: "text/markdown",
            type: "document",
          }),
        ],
        displayText: "summarize this",
        id: "user-1",
        role: "user",
        timestamp: 123,
      }),
    );
    expect(Array.isArray(message?.content) ? message.content[0] : undefined).toEqual({
      text: "summarize this",
      type: "text",
    });
    expect(Array.isArray(message?.content) ? message.content[1] : undefined).toEqual({
      text: "\n\n[Document: notes.md]\n# Hello",
      type: "text",
    });
    expect(message ? getUserText(message) : "").toBe("summarize this");
  });

  it("infers supported document types from filename when the browser reports octet-stream", async () => {
    const message = await createUserMessageFromTurnInput({
      id: "user-octet",
      input: {
        files: [
          {
            filename: "notes.md",
            mediaType: "application/octet-stream",
            size: 5,
            url: dataUrl("application/octet-stream", "hello"),
          },
        ],
        text: "read",
      },
      timestamp: 234,
    });

    expect(message?.attachments?.[0]?.mediaType).toBe("text/plain");
    expect(Array.isArray(message?.content) ? message.content[1] : undefined).toEqual({
      text: "\n\n[Document: notes.md]\nhello",
      type: "text",
    });
  });

  it("turns image attachments into ImageContent blocks", async () => {
    const message = await createUserMessageFromTurnInput({
      id: "user-2",
      input: {
        files: [
          {
            filename: "screen.png",
            mediaType: "image/png",
            size: 5,
            url: dataUrl("image/png", "image"),
          },
        ],
        text: "",
      },
      timestamp: 456,
    });

    expect(message?.displayText).toBe("Attached screen.png");
    expect(message?.attachments?.[0]).toEqual(
      expect.objectContaining({
        contentPartIndex: 0,
        fileName: "screen.png",
        mediaType: "image/png",
        type: "image",
      }),
    );
    expect(Array.isArray(message?.content) ? message.content[0] : undefined).toEqual({
      data: btoa("image"),
      mimeType: "image/png",
      type: "image",
    });
  });

  it("rejects unsupported binary attachments", async () => {
    await expect(
      createUserMessageFromTurnInput({
        id: "user-3",
        input: {
          files: [
            {
              filename: "archive.bin",
              mediaType: "application/octet-stream",
              size: 3,
              url: dataUrl("application/octet-stream", "bin"),
            },
          ],
          text: "inspect",
        },
        timestamp: 789,
      }),
    ).rejects.toThrow(/Unsupported attachment archive\.bin/);
  });
});
