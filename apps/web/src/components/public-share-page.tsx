import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { buildForkPromptFromSharedSession } from "@gitinspect/pi/lib/public-share";
import { repoSourceToGitHubUrl } from "@gitinspect/pi/repo/url";
import {
  persistLastUsedSessionSettings,
  resolveProviderDefaults,
} from "@gitinspect/pi/sessions/session-actions";
import { getCanonicalProvider } from "@gitinspect/pi/models/catalog";
import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";
import { ChatComposer } from "@gitinspect/ui/components/chat-composer";
import { ChatMessage as ChatMessageBlock } from "@gitinspect/ui/components/chat-message";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@gitinspect/ui/components/ai-elements/conversation";
import { StatusShimmer } from "@gitinspect/ui/components/ai-elements/shimmer";
import { Button } from "@gitinspect/ui/components/button";
import { ProgressiveBlur } from "@gitinspect/ui/components/progressive-blur";
import { useConversationStarter } from "@gitinspect/ui/hooks/use-conversation-starter";
import { getFoldedToolResultIds } from "@gitinspect/pi/lib/chat-adapter";
import {
  loadPublicSessionSnapshot,
  type PublicSessionSnapshot,
} from "@gitinspect/pi/lib/public-share-client";

type Draft = {
  model: string;
  providerGroup: ProviderGroupId;
  thinkingLevel: ThinkingLevel;
};

type SnapshotState =
  | { kind: "error"; message: string }
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "ready"; snapshot: PublicSessionSnapshot };

function SharedTranscriptLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center px-6 text-sm text-muted-foreground">
      <StatusShimmer>Loading shared transcript...</StatusShimmer>
    </div>
  );
}

function SharedTranscriptNotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-medium">Shared transcript not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This link may have expired, been removed, or never existed.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link
          search={{ feedback: undefined, settings: undefined, sidebar: undefined, tab: undefined }}
          to="/"
        >
          Go home
        </Link>
      </Button>
    </div>
  );
}

function SharedTranscriptError(props: { message: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-medium">Could not load shared transcript</h1>
        <p className="max-w-md text-sm text-muted-foreground">{props.message}</p>
      </div>
      <Button asChild variant="outline">
        <Link
          search={{ feedback: undefined, settings: undefined, sidebar: undefined, tab: undefined }}
          to="/"
        >
          Go home
        </Link>
      </Button>
    </div>
  );
}

export function PublicSharePage(props: { sessionId: string }) {
  const [snapshotState, setSnapshotState] = React.useState<SnapshotState>({ kind: "loading" });
  const defaults = useLiveQuery(async () => {
    const resolved = await resolveProviderDefaults();

    return {
      model: resolved.model,
      providerGroup: resolved.providerGroup,
      thinkingLevel: "medium" as ThinkingLevel,
    } satisfies Draft;
  }, []);
  const [draft, setDraft] = React.useState<Draft | undefined>(undefined);
  const { isStartingSession, startNewConversation } = useConversationStarter();

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const snapshot = await loadPublicSessionSnapshot(props.sessionId);

        if (cancelled) {
          return;
        }

        setSnapshotState(snapshot ? { kind: "ready", snapshot } : { kind: "not-found" });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Unknown error";
        setSnapshotState({ kind: "error", message });
      }
    }

    setSnapshotState({ kind: "loading" });
    void load();

    return () => {
      cancelled = true;
    };
  }, [props.sessionId]);

  React.useEffect(() => {
    if (!defaults) {
      return;
    }

    setDraft((currentDraft) => currentDraft ?? defaults);
  }, [defaults]);

  const persistDraft = React.useCallback((nextDraft: Draft) => {
    setDraft(nextDraft);
    void persistLastUsedSessionSettings({
      model: nextDraft.model,
      provider: getCanonicalProvider(nextDraft.providerGroup),
      providerGroup: nextDraft.providerGroup,
    });
  }, []);

  const handleSend = React.useCallback(
    async (prompt: string) => {
      if (snapshotState.kind !== "ready" || !draft) {
        return;
      }

      const forkPrompt = buildForkPromptFromSharedSession({
        messages: snapshotState.snapshot.messages,
        prompt,
        repoSource: snapshotState.snapshot.session.repoSource,
        sourceUrl: snapshotState.snapshot.session.sourceUrl,
      });
      const session = await startNewConversation({
        initialPrompt: forkPrompt,
        model: draft.model,
        providerGroup: draft.providerGroup,
        repoSource: snapshotState.snapshot.session.repoSource,
        sourceUrl: snapshotState.snapshot.session.sourceUrl,
        thinkingLevel: draft.thinkingLevel,
      });

      if (session) {
        toast.success("Started a new private conversation");
      }
    },
    [draft, snapshotState, startNewConversation],
  );

  if (snapshotState.kind === "loading") {
    return <SharedTranscriptLoading />;
  }

  if (snapshotState.kind === "not-found") {
    return <SharedTranscriptNotFound />;
  }

  if (snapshotState.kind === "error") {
    return <SharedTranscriptError message={snapshotState.message} />;
  }

  if (!draft) {
    return <SharedTranscriptLoading />;
  }

  const { snapshot } = snapshotState;
  const foldedToolResultIds = getFoldedToolResultIds(snapshot.messages);
  const repoUrl = snapshot.session.repoSource
    ? repoSourceToGitHubUrl(snapshot.session.repoSource)
    : snapshot.session.sourceUrl;

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background">
      <div className="border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-6">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                Shared transcript
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {snapshot.session.title}
              </h1>
            </div>
            <Button asChild variant="outline">
              <Link
                search={{
                  feedback: undefined,
                  settings: undefined,
                  sidebar: undefined,
                  tab: undefined,
                }}
                to="/"
              >
                Open gitinspect
              </Link>
            </Button>
          </div>
          {repoUrl ? (
            <a
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              href={repoUrl}
              rel="noreferrer"
              target="_blank"
            >
              {snapshot.session.repoSource
                ? `${snapshot.session.repoSource.owner}/${snapshot.session.repoSource.repo} · ${snapshot.session.repoSource.ref}`
                : repoUrl}
            </a>
          ) : null}
          <p className="text-sm text-muted-foreground">
            This page is read-only. Sending a message below starts a new private conversation in
            your own workspace.
          </p>
        </div>
      </div>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-4xl px-4 py-6">
          {snapshot.messages.map((message, index) => {
            if (message.role === "toolResult" && foldedToolResultIds.has(message.id)) {
              return null;
            }

            return (
              <ChatMessageBlock
                followingMessages={snapshot.messages.slice(index + 1)}
                isStreamingReasoning={false}
                key={message.id}
                message={message}
              />
            );
          })}
        </ConversationContent>
        <ConversationScrollButton className="z-[15]" />
        {snapshot.messages.length > 0 ? (
          <>
            <ProgressiveBlur className="z-[5]" height="32px" position="top" />
            <ProgressiveBlur className="z-[5]" position="bottom" />
          </>
        ) : null}
      </Conversation>

      <div className="border-t border-border/60 bg-background/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            New messages stay private to you and won&apos;t modify this shared transcript.
          </div>
          <ChatComposer
            composerDisabled={isStartingSession}
            disabledReason={isStartingSession ? "Starting your private conversation..." : undefined}
            isStreaming={isStartingSession}
            model={draft.model}
            onAbort={() => {}}
            onSelectModel={(providerGroup, model) => {
              persistDraft({
                model,
                providerGroup,
                thinkingLevel: draft.thinkingLevel,
              });
            }}
            onSend={handleSend}
            onThinkingLevelChange={(thinkingLevel) => {
              persistDraft({
                model: draft.model,
                providerGroup: draft.providerGroup,
                thinkingLevel,
              });
            }}
            placeholder="Ask a follow-up privately"
            providerGroup={draft.providerGroup}
            thinkingLevel={draft.thinkingLevel}
          />
        </div>
      </div>
    </div>
  );
}
