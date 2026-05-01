"use client";

import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { getFoldedToolResultIds } from "@webaura/pi/lib/chat-adapter";
import { ChatComposer } from "./chat-composer";
import { SessionUtilityActions } from "./session-utility-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webaura/ui/components/dialog";
import { Button } from "@webaura/ui/components/button";
import { ChatEmptyState } from "./chat-empty-state";
import { ChatMessage as ChatMessageBlock } from "./chat-message";
import type { UserTurnInput } from "@webaura/pi/agent/user-turn-input";
import type { ProviderGroupId, ThinkingLevel } from "@webaura/pi/types/models";
import type { AssistantMessage, DisplayChatMessage } from "@webaura/pi/types/chat";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@webaura/ui/components/ai-elements/conversation";
import { StatusShimmer } from "@webaura/ui/components/ai-elements/shimmer";
import { ProgressiveBlur } from "@webaura/ui/components/progressive-blur";
import { copySessionToClipboard } from "@webaura/pi/lib/copy-session-markdown";
import {
  buildShareSnapshot,
  createShareLink,
  ShareError,
  type CreatedShareLink,
} from "@webaura/pi/lib/share";
import { db } from "@webaura/db";
import { runtimeClient } from "@webaura/pi/agent/runtime-client";
import { getRuntimeCommandErrorMessage } from "@webaura/pi/agent/runtime-command-errors";
import { useRuntimeSession } from "@webaura/pi/hooks/use-runtime-session";
import { useSessionOwnership } from "@webaura/pi/hooks/use-session-ownership";
import {
  getCanonicalProvider,
  getConnectedProviders,
  getDefaultModelForGroup,
  getDefaultProviderGroup,
  getVisibleProviderGroups,
} from "@webaura/pi/models/catalog";
import {
  persistLastUsedSessionSettings,
  resolveProviderDefaults,
} from "@webaura/pi/sessions/session-actions";
import { reconcileInterruptedSession } from "@webaura/pi/sessions/session-notices";
import {
  loadSessionViewModel,
  type SessionViewModel,
} from "@webaura/pi/sessions/session-view-model";
import {
  deriveActiveSessionViewState,
  deriveBannerState,
  deriveComposerState,
  deriveRecoveryIntent,
  deriveResumeAction,
  shouldDisplayConversationStreaming,
} from "@webaura/pi/sessions/session-view-state";
import { useConversationStarter } from "@webaura/ui/hooks/use-conversation-starter";

type EmptyChatDraft = {
  model: string;
  providerGroup: ProviderGroupId;
  thinkingLevel: ThinkingLevel;
};

type LoadedSessionState =
  | { kind: "active"; viewModel: SessionViewModel }
  | { kind: "missing" }
  | { kind: "none" };

type ChatPanelMode = "empty" | "messages" | "starting" | "streaming_pending";

export interface ChatProps {
  sessionId?: string;
}

function isSystemNotice(
  message: DisplayChatMessage,
): message is Extract<DisplayChatMessage, { role: "system" }> {
  return message.role === "system";
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function getChatPanelMode(input: {
  hasAssistantMessage: boolean;
  isStartingSession: boolean;
  isStreaming: boolean;
  messageCount: number;
}): ChatPanelMode {
  if (input.isStartingSession && input.messageCount === 0) {
    return "starting";
  }

  if (input.isStreaming && input.messageCount > 0 && !input.hasAssistantMessage) {
    return "streaming_pending";
  }

  if (input.messageCount === 0) {
    return "empty";
  }

  return "messages";
}

function formatRelativeProgress(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);

  if (elapsedMinutes < 1) {
    return "just now";
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function getLastAssistantMessage(
  messages: ReadonlyArray<DisplayChatMessage>,
): AssistantMessage | undefined {
  return [...messages]
    .reverse()
    .find((message): message is AssistantMessage => message.role === "assistant");
}

export function Chat(props: ChatProps) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const settings = typeof search.settings === "string" ? search.settings : undefined;
  const sidebar = search.sidebar === "open" ? "open" : undefined;
  const q = typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined;
  const loadedSessionState = useLiveQuery(async (): Promise<LoadedSessionState> => {
    if (!props.sessionId) {
      return { kind: "none" };
    }

    const viewModel = await loadSessionViewModel(props.sessionId);

    if (!viewModel) {
      return { kind: "missing" };
    }

    return {
      kind: "active",
      viewModel,
    };
  }, [props.sessionId]);
  const defaults = useLiveQuery(async () => {
    const resolved = await resolveProviderDefaults();

    return {
      model: resolved.model,
      providerGroup: resolved.providerGroup,
      thinkingLevel: "medium" as ThinkingLevel,
    } satisfies EmptyChatDraft;
  }, []);
  const providerKeysResult = useLiveQuery(() => db.providerKeys.toArray(), []);
  const providerKeys = Array.isArray(providerKeysResult) ? providerKeysResult : [];
  const [draft, setDraft] = React.useState<EmptyChatDraft | undefined>(undefined);
  const [manualShareLink, setManualShareLink] = React.useState<CreatedShareLink | undefined>(
    undefined,
  );
  const [isSharePending, setIsSharePending] = React.useState(false);
  const runtime = useRuntimeSession(props.sessionId);
  const { isStartingSession, startNewConversation } = useConversationStarter();
  const ownership = useSessionOwnership(
    loadedSessionState?.kind === "active" ? loadedSessionState.viewModel.session.id : undefined,
  );
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const recoveryInFlightRef = React.useRef(false);
  const surfacedSystemNoticeFingerprintsRef = React.useRef(new Set<string>());
  const surfacedSystemNoticeSessionIdRef = React.useRef<string | undefined>(undefined);
  const [promptHeight, setPromptHeight] = React.useState(0);

  const promptRef = React.useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateHeight = () => {
      setPromptHeight(node.offsetHeight);
    };

    updateHeight();

    observerRef.current = new ResizeObserver(updateHeight);
    observerRef.current.observe(node);
  }, []);

  const sessionViewModel =
    loadedSessionState?.kind === "active" ? loadedSessionState.viewModel : undefined;
  const activeSession = sessionViewModel?.session;
  const sessionRuntime = sessionViewModel?.runtime;
  const connectedProviders = React.useMemo(
    () => getConnectedProviders(providerKeys),
    [providerKeys],
  );

  React.useEffect(() => {
    if (!defaults) {
      return;
    }

    setDraft((currentDraft) => currentDraft ?? defaults);
  }, [defaults]);

  React.useEffect(() => {
    if (activeSession || !draft) {
      return;
    }

    const visibleProviderGroups = getVisibleProviderGroups(connectedProviders);

    if (visibleProviderGroups.includes(draft.providerGroup)) {
      return;
    }

    const fallbackProviderGroup = visibleProviderGroups[0] ?? draft.providerGroup;
    setDraft((currentDraft) => {
      if (!currentDraft || visibleProviderGroups.includes(currentDraft.providerGroup)) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        model: getDefaultModelForGroup(fallbackProviderGroup).id,
        providerGroup: fallbackProviderGroup,
      };
    });
  }, [activeSession, connectedProviders, draft]);

  const messages = sessionViewModel?.displayMessages ?? [];
  const hasAssistantMessage = React.useMemo(
    () => messages.some((message) => message.role === "assistant"),
    [messages],
  );
  const foldedToolResultIds = React.useMemo(() => getFoldedToolResultIds(messages), [messages]);
  const lastAssistantMessage = React.useMemo(() => getLastAssistantMessage(messages), [messages]);
  const lastAssistantMessageId = React.useMemo(
    () => lastAssistantMessage?.id,
    [lastAssistantMessage],
  );
  const hasPartialAssistantText = sessionViewModel?.hasPartialAssistantText ?? false;
  const activeSessionViewState = React.useMemo(
    () =>
      activeSession
        ? deriveActiveSessionViewState({
            hasLocalRunner: runtimeClient.hasActiveTurn(activeSession.id),
            hasPartialAssistantText,
            lastProgressAt: sessionRuntime?.lastProgressAt,
            leaseState: ownership,
            runtimePhase: sessionRuntime?.phase,
            runtimeStatus: sessionRuntime?.status,
            sessionIsStreaming: activeSession.isStreaming,
          })
        : undefined,
    [
      activeSession,
      hasPartialAssistantText,
      ownership,
      sessionRuntime?.lastProgressAt,
      sessionRuntime?.phase,
      sessionRuntime?.status,
    ],
  );

  React.useEffect(() => {
    if (surfacedSystemNoticeSessionIdRef.current === activeSession?.id) {
      return;
    }

    surfacedSystemNoticeSessionIdRef.current = activeSession?.id;
    surfacedSystemNoticeFingerprintsRef.current = new Set(
      messages.filter(isSystemNotice).map((message) => message.fingerprint),
    );
  }, [activeSession?.id, messages]);

  React.useEffect(() => {
    if (!activeSession?.id) {
      return;
    }

    if (surfacedSystemNoticeSessionIdRef.current !== activeSession.id) {
      return;
    }

    const seenFingerprints = surfacedSystemNoticeFingerprintsRef.current;
    const unseenErrors = messages.filter(
      (message): message is Extract<DisplayChatMessage, { role: "system" }> =>
        isSystemNotice(message) &&
        message.severity === "error" &&
        !seenFingerprints.has(message.fingerprint),
    );

    for (const message of unseenErrors) {
      seenFingerprints.add(message.fingerprint);
      toast.error(getRuntimeCommandErrorMessage(new Error(message.message)));
    }
  }, [activeSession?.id, messages]);

  const recoveryIntent = React.useMemo(
    () => (activeSessionViewState ? deriveRecoveryIntent(activeSessionViewState) : "none"),
    [activeSessionViewState],
  );
  const bannerState = React.useMemo(
    () => (activeSessionViewState ? deriveBannerState(activeSessionViewState) : undefined),
    [activeSessionViewState],
  );
  const resumeAction = React.useMemo(
    () => (activeSessionViewState ? deriveResumeAction(activeSessionViewState) : undefined),
    [activeSessionViewState],
  );
  const activeComposerState = React.useMemo(
    () => (activeSessionViewState ? deriveComposerState(activeSessionViewState) : undefined),
    [activeSessionViewState],
  );
  const lastProgressLabel = React.useMemo(
    () => formatRelativeProgress(sessionRuntime?.lastProgressAt),
    [sessionRuntime?.lastProgressAt],
  );
  const displayConversationStreaming = React.useMemo(
    () =>
      activeSessionViewState ? shouldDisplayConversationStreaming(activeSessionViewState) : false,
    [activeSessionViewState],
  );

  const maybeRecoverInterruptedSession = React.useEffectEvent(
    async (trigger: "mount" | "visibility") => {
      if (!activeSession || recoveryIntent !== "run-now") {
        return;
      }

      if (recoveryInFlightRef.current) {
        return;
      }

      recoveryInFlightRef.current = true;

      try {
        const outcome = await reconcileInterruptedSession(activeSession.id, {
          hasLocalRunner: runtimeClient.hasActiveTurn(activeSession.id),
        });

        if (outcome.kind === "reconciled") {
          console.info("[webaura:runtime] interrupted_session_reconciled", {
            lastProgressAt: outcome.lastProgressAt,
            sessionId: activeSession.id,
            trigger,
          });
        }
      } catch (error) {
        console.error("[webaura:runtime] stale_stream_reconcile_failed", {
          error,
          sessionId: activeSession.id,
          trigger,
        });
      } finally {
        recoveryInFlightRef.current = false;
      }
    },
  );

  React.useEffect(() => {
    if (!activeSession || recoveryIntent !== "run-now") {
      return;
    }

    void maybeRecoverInterruptedSession("mount");
  }, [activeSession?.id, maybeRecoverInterruptedSession, recoveryIntent]);

  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (!activeSession || recoveryIntent !== "run-now") {
        return;
      }

      void maybeRecoverInterruptedSession("visibility");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeSession?.id, maybeRecoverInterruptedSession, recoveryIntent]);

  React.useEffect(() => {
    if (loadedSessionState?.kind !== "missing") {
      return;
    }

    void navigate({
      replace: true,
      search: {
        q: undefined,
        settings,
        sidebar,
      },
      to: "/chat",
    });
  }, [loadedSessionState, navigate, settings, sidebar]);

  const persistDraft = React.useCallback((nextDraft: EmptyChatDraft) => {
    setDraft(nextDraft);
    void persistLastUsedSessionSettings({
      model: nextDraft.model,
      provider: getCanonicalProvider(nextDraft.providerGroup),
      providerGroup: nextDraft.providerGroup,
    });
  }, []);

  const reportRuntimeFailure = React.useCallback(
    (error: Error) => {
      toast.error(getRuntimeCommandErrorMessage(error));
      console.error("[webaura:runtime] command_failed", {
        message: error.message,
        sessionId: activeSession?.id,
      });
    },
    [activeSession?.id],
  );

  const handleFirstSend = React.useCallback(
    async (input: UserTurnInput) => {
      if (!draft) {
        return;
      }

      await startNewConversation({
        initialPrompt: input,
        model: draft.model,
        providerGroup: draft.providerGroup,
        thinkingLevel: draft.thinkingLevel,
      });
    },
    [draft, startNewConversation],
  );

  const handleSend = React.useCallback(
    async (input: UserTurnInput) => {
      if (activeSession) {
        if (!activeComposerState?.canSend) {
          if (activeComposerState?.disabledReason) {
            toast.error(activeComposerState.disabledReason);
          }
          return;
        }

        try {
          await runtime.send(input);
        } catch (error) {
          const runtimeError = error instanceof Error ? error : new Error(String(error));
          reportRuntimeFailure(runtimeError);
          throw runtimeError;
        }
        return;
      }

      await handleFirstSend(input);
    },
    [activeComposerState, activeSession, handleFirstSend, reportRuntimeFailure, runtime],
  );

  const handleResumeInterrupted = React.useCallback(async () => {
    if (!resumeAction) {
      return;
    }

    try {
      await runtime.resumeInterrupted(resumeAction.mode);
    } catch (error) {
      reportRuntimeFailure(error instanceof Error ? error : new Error(String(error)));
    }
  }, [reportRuntimeFailure, resumeAction, runtime]);

  const handleCopySession = React.useCallback(() => {
    void copySessionToClipboard(messages).then(
      () => toast.success("Copied session as Markdown"),
      () => toast.error("Failed to copy to clipboard"),
    );
  }, [messages]);

  const handleShareSession = React.useCallback(() => {
    if (isSharePending) {
      return;
    }

    setIsSharePending(true);

    const snapshot = buildShareSnapshot(messages, {
      model: activeSession?.model ?? draft?.model,
      provider: activeSession?.provider,
      title: activeSession?.title,
    });

    void createShareLink(snapshot)
      .then(async (share) => {
        try {
          await navigator.clipboard.writeText(share.link);
          toast.success(
            share.mode === "nostr" ? "Copied encrypted Nostr share link" : "Copied share link",
          );
        } catch {
          setManualShareLink(share);
          toast.error("Share link created, but clipboard access was blocked");
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ShareError) {
          toast.error(error.message);
          return;
        }

        toast.error("Failed to create share link");
      })
      .finally(() => setIsSharePending(false));
  }, [
    activeSession?.model,
    activeSession?.provider,
    activeSession?.title,
    draft?.model,
    isSharePending,
    messages,
  ]);

  const handleCopyManualShareLink = React.useCallback(() => {
    if (!manualShareLink) {
      return;
    }

    void navigator.clipboard.writeText(manualShareLink.link).then(
      () => toast.success("Copied share link"),
      () => toast.error("Failed to copy share link"),
    );
  }, [manualShareLink]);

  if (loadedSessionState === undefined) {
    return <LoadingState label="Loading session..." />;
  }

  if (loadedSessionState.kind === "missing") {
    return <LoadingState label="Loading session..." />;
  }

  if (!activeSession && !draft) {
    return <LoadingState label="Loading composer..." />;
  }

  const currentModel = activeSession?.model ?? draft?.model ?? "";
  const currentProviderGroup =
    activeSession?.providerGroup ??
    (activeSession ? getDefaultProviderGroup(activeSession.provider) : undefined) ??
    draft?.providerGroup ??
    getVisibleProviderGroups(connectedProviders)[0];
  const currentThinkingLevel = activeSession?.thinkingLevel ?? draft?.thinkingLevel ?? "medium";
  const isStreaming =
    activeSession !== undefined ? (activeComposerState?.isStreaming ?? false) : isStartingSession;
  const composerDisabled = activeComposerState?.disabled === true;
  const composerDisabledReason = activeComposerState?.disabledReason;
  const chatPanelMode = getChatPanelMode({
    hasAssistantMessage,
    isStartingSession,
    isStreaming: displayConversationStreaming || isStartingSession,
    messageCount: messages.length,
  });

  return (
    <div
      className="relative flex size-full min-h-0 flex-col overflow-hidden"
      style={{ "--chat-input-height": `${promptHeight}px` } as React.CSSProperties}
    >
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setManualShareLink(undefined);
          }
        }}
        open={manualShareLink !== undefined}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share Link Ready</DialogTitle>
            <DialogDescription>
              Browser clipboard access was blocked after the encrypted share finished publishing.
              Copy the generated link manually.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-sm border border-border bg-muted/40 p-2">
            <textarea
              className="h-28 w-full resize-none bg-transparent font-mono text-xs text-foreground outline-none"
              readOnly
              value={manualShareLink?.link ?? ""}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleCopyManualShareLink} type="button">
              Copy Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={`mx-auto w-full max-w-4xl px-4 py-6 ${
            messages.length === 0 ? "min-h-full" : ""
          }`}
        >
          {bannerState?.kind === "remote-live" ? (
            <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              Read-only mirror. This session is active in another tab.
              {lastProgressLabel ? ` Last progress ${lastProgressLabel}.` : ""}
            </div>
          ) : bannerState?.kind === "remote-stale" ? (
            <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              Read-only mirror. Another tab still owns this streaming session.
              {lastProgressLabel ? ` Last progress ${lastProgressLabel}.` : ""}
            </div>
          ) : null}
          {chatPanelMode === "starting" ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <StatusShimmer>Starting session...</StatusShimmer>
            </div>
          ) : chatPanelMode === "streaming_pending" ? (
            <div className="mb-4 flex justify-start">
              <StatusShimmer>Assistant is streaming...</StatusShimmer>
            </div>
          ) : chatPanelMode === "empty" ? (
            <ChatEmptyState onSuggestionClick={(text) => void handleSend({ text })} />
          ) : (
            messages.map((message, index) => {
              if (message.role === "toolResult" && foldedToolResultIds.has(message.id)) {
                return null;
              }

              return (
                <ChatMessageBlock
                  followingMessages={messages.slice(index + 1)}
                  isStreamingReasoning={
                    displayConversationStreaming &&
                    message.role === "assistant" &&
                    lastAssistantMessageId === message.id
                  }
                  key={message.id}
                  message={message}
                />
              );
            })
          )}
        </ConversationContent>
        <ConversationScrollButton className="z-[15]" />
        {messages.length > 0 ? (
          <>
            <ProgressiveBlur className="z-[5]" height="32px" position="top" />
            <ProgressiveBlur
              className="z-[5]"
              position="bottom"
              style={{ bottom: "var(--chat-input-height, 0px)" }}
            />
          </>
        ) : null}
      </Conversation>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto w-full max-w-4xl px-4">
          <div className="pointer-events-auto flex items-center justify-end pb-2">
            {messages.length > 0 ? (
              <SessionUtilityActions
                isSharing={isSharePending}
                onCopy={handleCopySession}
                onShare={handleShareSession}
              />
            ) : null}
          </div>
        </div>

        <div className="pointer-events-auto bg-background">
          <div className="mx-auto w-full max-w-4xl px-4 pb-4">
            {bannerState?.kind === "interrupted" && resumeAction && activeSession ? (
              <div className="mb-3 rounded-md border border-border bg-muted px-3 py-3 text-sm text-foreground">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">Response interrupted</div>
                    <div className="text-muted-foreground">
                      {bannerState.resumeMode === "continue"
                        ? "A partial assistant response was saved locally."
                        : "The last response stopped before any assistant text was saved."}
                      {lastProgressLabel ? ` Last progress ${lastProgressLabel}.` : ""}
                    </div>
                  </div>
                  <button
                    className="inline-flex items-center justify-center rounded-sm border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    onClick={() => {
                      void handleResumeInterrupted();
                    }}
                    type="button"
                  >
                    {resumeAction.label}
                  </button>
                </div>
              </div>
            ) : null}
            <div ref={promptRef}>
              <ChatComposer
                composerDisabled={composerDisabled}
                disabledReason={composerDisabledReason}
                initialInput={messages.length === 0 ? q : undefined}
                isStreaming={isStreaming}
                model={currentModel}
                onAbort={activeSession && activeComposerState?.canAbort ? runtime.abort : () => {}}
                onSelectModel={(providerGroup, model) => {
                  if (activeSession) {
                    return runtime.setModelSelection(providerGroup, model);
                  }

                  persistDraft({
                    model,
                    providerGroup,
                    thinkingLevel: currentThinkingLevel,
                  });
                }}
                onSend={handleSend}
                onThinkingLevelChange={(thinkingLevel) => {
                  if (activeSession) {
                    return runtime.setThinkingLevel(thinkingLevel);
                  }

                  persistDraft({
                    model: currentModel,
                    providerGroup: currentProviderGroup,
                    thinkingLevel,
                  });
                }}
                providerGroup={currentProviderGroup}
                thinkingLevel={currentThinkingLevel}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
