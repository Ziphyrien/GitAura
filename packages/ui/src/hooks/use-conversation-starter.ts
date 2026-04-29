import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { event as trackEvent } from "onedollarstats";
import { toast } from "sonner";
import { runtimeClient } from "@webaura/pi/agent/runtime-client";
import type { UserTurnInput } from "@webaura/pi/agent/user-turn-input";
import { getRuntimeCommandErrorMessage } from "@webaura/pi/agent/runtime-command-errors";
import {
  createSessionForChat,
  persistLastUsedSessionSettings,
} from "@webaura/pi/sessions/session-actions";
import { getCanonicalProvider } from "@webaura/pi/models/catalog";
import type { ProviderGroupId, ThinkingLevel } from "@webaura/pi/types/models";

export function useConversationStarter() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const settings = typeof search.settings === "string" ? search.settings : undefined;
  const sidebar = search.sidebar === "open" ? "open" : undefined;
  const [isStartingSession, setIsStartingSession] = React.useState(false);

  const startNewConversation = React.useCallback(
    async (input: {
      initialPrompt: string | UserTurnInput;
      model: string;
      providerGroup: ProviderGroupId;
      thinkingLevel: ThinkingLevel;
    }) => {
      if (isStartingSession) {
        return undefined;
      }

      setIsStartingSession(true);

      try {
        const base = {
          model: input.model,
          provider: getCanonicalProvider(input.providerGroup),
          providerGroup: input.providerGroup,
          thinkingLevel: input.thinkingLevel,
        };
        const session = await createSessionForChat(base);

        await runtimeClient.startInitialTurn(session, input.initialPrompt);
        void trackEvent("Message sent").catch(() => {
          // Analytics must never interfere with chat sends.
        });
        await navigate({
          params: {
            sessionId: session.id,
          },
          search: {
            q: undefined,
            settings,
            sidebar,
          },
          to: "/chat/$sessionId",
        });

        void persistLastUsedSessionSettings(session);
        return session;
      } catch (error) {
        const runtimeError = error instanceof Error ? error : new Error(String(error));
        toast.error(getRuntimeCommandErrorMessage(runtimeError));
        console.error("[webaura:runtime] command_failed", {
          message: runtimeError.message,
        });
        throw runtimeError;
      } finally {
        setIsStartingSession(false);
      }
    },
    [isStartingSession, navigate, settings, sidebar],
  );

  return {
    isStartingSession,
    startNewConversation,
  };
}
