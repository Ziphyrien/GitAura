import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyUsage } from "@/types/models";
import type { SessionData } from "@/types/storage";

const useLiveQueryMock = vi.fn();
const navigateMock = vi.fn(async () => {});
const useSearchMock = vi.fn(() => ({}));
const startInitialTurnMock = vi.fn(async () => {});
const createSessionForChatMock = vi.fn();
const persistLastUsedSessionSettingsMock = vi.fn(async () => {});

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: useLiveQueryMock,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}));

vi.mock("@/hooks/use-runtime-session", () => ({
  useRuntimeSession: () => ({
    abort: vi.fn(),
    send: vi.fn(),
    setModelSelection: vi.fn(),
    setThinkingLevel: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-session-ownership", () => ({
  useSessionOwnership: () => ({ kind: "owned" }),
}));

vi.mock("@/agent/runtime-client", () => ({
  runtimeClient: {
    hasActiveTurn: vi.fn(() => false),
    startInitialTurn: startInitialTurnMock,
  },
}));

vi.mock("@/sessions/session-notices", () => ({
  reconcileInterruptedSession: vi.fn(async () => ({ kind: "noop" })),
}));

vi.mock("@/sessions/session-actions", () => ({
  createSessionForChat: createSessionForChatMock,
  persistLastUsedSessionSettings: persistLastUsedSessionSettingsMock,
  resolveProviderDefaults: vi.fn(async () => ({
    model: "gpt-5.1-codex-mini",
    providerGroup: "openai-codex",
  })),
}));

vi.mock("@/components/chat-empty-state", () => ({
  ChatEmptyState: () => <div data-testid="empty-state">empty</div>,
}));

vi.mock("@/components/chat-composer", () => ({
  ChatComposer: ({ onSend }: { onSend: (input: { text: string }) => Promise<void> }) => (
    <button onClick={() => void onSend({ text: "hello" })} type="button">
      Send
    </button>
  ),
}));

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationScrollButton: () => null,
}));

vi.mock("@/components/ui/progressive-blur", () => ({
  ProgressiveBlur: () => null,
}));

vi.mock("@/components/chat-message", () => ({
  ChatMessage: () => null,
}));

vi.mock("@/components/session-utility-actions", () => ({
  SessionUtilityActions: () => null,
}));

vi.mock("@/components/chat-adapter", () => ({
  getFoldedToolResultIds: () => new Set<string>(),
}));

function buildSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

function createDeferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve: () => resolve?.(),
  };
}

function mockChatQueries(options: {
  defaults: {
    model: string;
    providerGroup: string;
    thinkingLevel: string;
  };
  loadedSessionState:
    | { kind: "none" | "missing" }
    | {
        kind: "active";
        viewModel: {
          displayMessages: unknown[];
          hasPartialAssistantText: boolean;
          isStreaming: boolean;
          runtime?: unknown;
          session: SessionData;
          transcriptMessages: unknown[];
        };
      };
}) {
  useLiveQueryMock.mockImplementation(() => {
    const callIndex = useLiveQueryMock.mock.calls.length;

    switch ((callIndex - 1) % 3) {
      case 0:
        return options.loadedSessionState;
      case 1:
        return options.defaults;
      default:
        return [];
    }
  });
}

describe("Chat first send", () => {
  beforeEach(() => {
    createSessionForChatMock.mockReset();
    navigateMock.mockReset();
    persistLastUsedSessionSettingsMock.mockReset();
    startInitialTurnMock.mockReset();
    useLiveQueryMock.mockReset();
  });

  it("starts the initial turn before navigating to the new session", async () => {
    const session = buildSession();
    createSessionForChatMock.mockResolvedValue(session);
    mockChatQueries({
      defaults: {
        model: "gpt-5.1-codex-mini",
        providerGroup: "openai-codex",
        thinkingLevel: "medium",
      },
      loadedSessionState: { kind: "none" },
    });

    const { Chat } = await import("@/components/chat");

    render(<Chat />);

    await act(async () => {
      fireEvent.click(screen.getByText("Send"));
    });

    await vi.waitFor(() => {
      expect(startInitialTurnMock).toHaveBeenCalledWith(session, { text: "hello" });
    });

    expect(startInitialTurnMock.mock.invocationCallOrder[0]).toBeLessThan(
      navigateMock.mock.invocationCallOrder[0],
    );
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          sessionId: "session-1",
        },
        to: "/chat/$sessionId",
      }),
    );
  });

  it("does not block navigation on settings persistence", async () => {
    const session = buildSession();
    const settingsWrite = createDeferred();
    createSessionForChatMock.mockResolvedValue(session);
    persistLastUsedSessionSettingsMock.mockImplementation(async () => await settingsWrite.promise);
    mockChatQueries({
      defaults: {
        model: "gpt-5.1-codex-mini",
        providerGroup: "openai-codex",
        thinkingLevel: "medium",
      },
      loadedSessionState: { kind: "none" },
    });

    const { Chat } = await import("@/components/chat");

    render(<Chat />);

    await act(async () => {
      fireEvent.click(screen.getByText("Send"));
    });

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });

    expect(persistLastUsedSessionSettingsMock).toHaveBeenCalledWith(session);
    settingsWrite.resolve();
    await act(async () => {
      await settingsWrite.promise;
    });
  });
});
