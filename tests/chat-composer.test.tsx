import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatComposer } from "@/components/chat-composer";
import { renderWithProviders } from "@/test/render-with-providers";
import {
  SUPPORTED_ATTACHMENT_ACCEPT,
  SUPPORTED_ATTACHMENT_PICKER_TYPES,
} from "@gitaura/pi/agent/user-turn-input";

vi.mock("@/components/chat-model-selector", () => ({
  ChatModelSelector: () => <span data-testid="model-selector">Model</span>,
}));

describe("ChatComposer", () => {
  it("trims and sends text on submit", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ChatComposer
        isStreaming={false}
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={onSend}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />,
    );

    const input = screen.getByPlaceholderText(
      "What would you like to know?",
    ) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "  hello world  " } });

    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith({
        files: [],
        text: "hello world",
      });
    });
  });

  it("disables input and submit when composerDisabled", async () => {
    const onSend = vi.fn();

    renderWithProviders(
      <ChatComposer
        composerDisabled
        isStreaming={false}
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={onSend}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />,
    );

    const input = screen.getByPlaceholderText(
      "Select a repository to get started",
    ) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);

    await act(async () => {
      fireEvent.input(input, { target: { value: "hello" } });
      fireEvent.submit(input.closest("form") as HTMLFormElement);
      await Promise.resolve();
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("opens the native file picker without an All files option when supported", async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const originalPicker = "showOpenFilePicker" in window ? window.showOpenFilePicker : undefined;
    const showOpenFilePicker = vi.fn(async () => []);

    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: showOpenFilePicker,
    });

    try {
      renderWithProviders(
        <ChatComposer
          isStreaming={false}
          model="gpt-5.1-codex-mini"
          onAbort={() => {}}
          onSelectModel={() => {}}
          onSend={vi.fn()}
          onThinkingLevelChange={() => {}}
          providerGroup="openai-codex"
          thinkingLevel="medium"
        />,
      );

      const fileInput = screen.getByLabelText("Upload files") as HTMLInputElement;
      expect(fileInput.accept).toBe(SUPPORTED_ATTACHMENT_ACCEPT);
      expect(fileInput.accept).toContain("image/*");

      fireEvent.click(screen.getByRole("button", { name: "Add attachments" }));

      await waitFor(() => {
        expect(showOpenFilePicker).toHaveBeenCalledWith({
          excludeAcceptAllOption: true,
          multiple: true,
          types: SUPPORTED_ATTACHMENT_PICKER_TYPES.map((type) => ({
            accept: Object.fromEntries(
              Object.entries(type.accept).map(([mediaType, extensions]) => [
                mediaType,
                [...extensions],
              ]),
            ),
            description: type.description,
          })),
        });
      });
      expect(inputClick).not.toHaveBeenCalled();
      expect(screen.queryByText("Add supported files")).toBeNull();
    } finally {
      inputClick.mockRestore();
      if (originalPicker) {
        Object.defineProperty(window, "showOpenFilePicker", {
          configurable: true,
          value: originalPicker,
        });
      } else {
        Reflect.deleteProperty(window, "showOpenFilePicker");
      }
    }
  });

  it("sends attachments without message text", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const createObjectUrl = vi.fn(() => "data:text/plain;base64,aGVsbG8=");
    const revokeObjectUrl = vi.fn();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    try {
      renderWithProviders(
        <ChatComposer
          isStreaming={false}
          model="gpt-5.1-codex-mini"
          onAbort={() => {}}
          onSelectModel={() => {}}
          onSend={onSend}
          onThinkingLevelChange={() => {}}
          providerGroup="openai-codex"
          thinkingLevel="medium"
        />,
      );

      const fileInput = screen.getByLabelText("Upload files") as HTMLInputElement;
      const file = new File(["hello"], "notes.txt", { type: "text/plain" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      const submit = screen.getByRole("button", { name: /submit/i });
      await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(submit);

      await waitFor(() => {
        expect(onSend).toHaveBeenCalledWith({
          files: [
            {
              filename: "notes.txt",
              mediaType: "text/plain",
              size: 5,
              url: "data:text/plain;base64,aGVsbG8=",
            },
          ],
          text: "",
        });
      });
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });

  it("rejects unsupported attachment types", () => {
    const onSend = vi.fn();
    const createObjectUrl = vi.fn(() => "blob:unsupported");
    const originalCreateObjectUrl = URL.createObjectURL;

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });

    try {
      renderWithProviders(
        <ChatComposer
          isStreaming={false}
          model="gpt-5.1-codex-mini"
          onAbort={() => {}}
          onSelectModel={() => {}}
          onSend={onSend}
          onThinkingLevelChange={() => {}}
          providerGroup="openai-codex"
          thinkingLevel="medium"
        />,
      );

      const fileInput = screen.getByLabelText("Upload files") as HTMLInputElement;
      fireEvent.change(fileInput, {
        target: {
          files: [new File(["zip"], "archive.zip", { type: "application/zip" })],
        },
      });

      expect(createObjectUrl).not.toHaveBeenCalled();
      const submit = screen.getByRole("button", { name: /submit/i });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submit);
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
    }
  });

  it("does not send when empty", () => {
    const onSend = vi.fn();

    renderWithProviders(
      <ChatComposer
        isStreaming={false}
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={onSend}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />,
    );

    const submit = screen.getByRole("button", { name: /submit/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables submit while streaming", () => {
    renderWithProviders(
      <ChatComposer
        isStreaming
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={vi.fn()}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />,
    );

    const submit = screen.getByRole("button", { name: /stop/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders model selector slot", () => {
    renderWithProviders(
      <ChatComposer
        isStreaming={false}
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={vi.fn()}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />,
    );

    expect(document.body.contains(screen.getByTestId("model-selector"))).toBe(true);
  });
});
