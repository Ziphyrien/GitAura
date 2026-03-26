import * as React from "react"
import { useRouterState } from "@tanstack/react-router"
import type { MessageRow, SessionData } from "@/types/storage"
import { runtimeClient } from "@/agent/runtime-client"
import { deleteSession } from "@/db/schema"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { useSessionData } from "@/hooks/use-session-data"
import { useSessionList } from "@/hooks/use-session-list"
import { useSessionMessages } from "@/hooks/use-session-messages"
import {
  persistVisibleSessionSelection,
  resolveProviderDefaults,
} from "@/sessions/initial-session"
import { persistLastUsedSessionSettings } from "@/sessions/session-selection"
import { normalizeRepoSource } from "@/repo/settings"
import { parsedPathToRepoSource, parseRepoPathname } from "@/repo/url"
import {
  createSession,
  loadSession,
  persistSessionSnapshot,
} from "@/sessions/session-service"
import { Chat } from "@/components/chat"
import { ChatHeader } from "@/components/chat-header"
import { ChatSidebar } from "@/components/chat-sidebar"
import {
  type SettingsSection,
  SettingsDialog,
} from "@/components/settings-dialog"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export type ChatShellMainContext = {
  activeSession: SessionData | undefined
  displayedIsStreaming: boolean
  messages: MessageRow[]
  openSettings: (section?: SettingsSection) => void
  runtime: ReturnType<typeof useRuntimeSession>
  selectedSessionId: string
}

export type ChatShellChromeProps = {
  /** Omitted on landing when there are no sessions yet. */
  initialSession?: SessionData
  openSettings: (section?: SettingsSection) => void
  renderMain: (ctx: ChatShellMainContext) => React.ReactNode
  sessions: ReturnType<typeof useSessionList>["sessions"]
  setSettingsOpen: (open: boolean) => void
  settingsSection: SettingsSection
  settingsOpen: boolean
}

export function ChatShellChrome(props: ChatShellChromeProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [selectedSessionId, setSelectedSessionId] = React.useState(
    props.initialSession?.id ?? ""
  )
  const activeSession = useSessionData(
    selectedSessionId ? selectedSessionId : undefined
  )
  const messages = useSessionMessages(
    selectedSessionId ? selectedSessionId : undefined
  ) ?? []
  const runtime = useRuntimeSession(
    selectedSessionId ? selectedSessionId : undefined
  )
  const parsedRepoPath = parseRepoPathname(pathname)
  const sessionsInRepo = React.useMemo(() => {
    if (!parsedRepoPath) {
      return props.sessions
    }

    return props.sessions.filter((session) => {
      const source = session.repoSource
      return (
        source?.owner === parsedRepoPath.owner &&
        source?.repo === parsedRepoPath.repo
      )
    })
  }, [parsedRepoPath, props.sessions])
  const selectedSessionMetadata = props.sessions.find(
    (session) => session.id === selectedSessionId
  )
  const displayedIsStreaming =
    activeSession?.isStreaming ?? selectedSessionMetadata?.isStreaming ?? false

  React.useEffect(() => {
    setSelectedSessionId(props.initialSession?.id ?? "")
  }, [props.initialSession?.id])

  React.useEffect(() => {
    if (props.sessions.length === 0) {
      return
    }

    if (props.sessions.some((session) => session.id === selectedSessionId)) {
      return
    }

    void (async () => {
      const stillExists = await loadSession(selectedSessionId)
      if (stillExists !== undefined) {
        return
      }

      const fallbackSession = props.sessions[0]

      setSelectedSessionId(fallbackSession.id)
      void persistLastUsedSessionSettings({
        model: fallbackSession.model,
        provider: fallbackSession.provider,
        providerGroup: fallbackSession.providerGroup,
      })
    })()
  }, [props.sessions, selectedSessionId])

  const runningSessionIds = sessionsInRepo
    .filter((session) => session.isStreaming)
    .map((session) => session.id)

  const handleCreateSession = React.useEffectEvent(async () => {
    const path =
      typeof window !== "undefined" ? window.location.pathname : ""
    const parsed = parseRepoPathname(path)
    const repoFromPath = parsed
      ? normalizeRepoSource(parsedPathToRepoSource(parsed))
      : undefined

    const baseSession = activeSession ?? props.initialSession
    if (!baseSession) {
      const { model, providerGroup, visibleProviderGroups } =
        await resolveProviderDefaults()
      const nextSession = createSession({
        model,
        providerGroup,
        repoSource: repoFromPath,
        thinkingLevel: "medium",
      })
      await persistSessionSnapshot(nextSession)
      const finalized = await persistVisibleSessionSelection(
        nextSession,
        visibleProviderGroups
      )
      setSelectedSessionId(finalized.id)
      await persistLastUsedSessionSettings(finalized)
      return
    }

    const nextSession = createSession({
      model: baseSession.model,
      providerGroup: baseSession.providerGroup ?? baseSession.provider,
      repoSource: repoFromPath ?? baseSession.repoSource,
      thinkingLevel: baseSession.thinkingLevel,
    })

    await persistSessionSnapshot(nextSession)
    setSelectedSessionId(nextSession.id)
    await persistLastUsedSessionSettings(nextSession)
  })

  const handleSelectSession = React.useEffectEvent(async (sessionId: string) => {
    setSelectedSessionId(sessionId)

    const selectedMetadata = props.sessions.find((session) => session.id === sessionId)

    if (!selectedMetadata) {
      const loaded = await loadSession(sessionId)
      if (loaded) {
        await persistLastUsedSessionSettings(loaded)
      }
      return
    }

    await persistLastUsedSessionSettings({
      model: selectedMetadata.model,
      provider: selectedMetadata.provider,
      providerGroup: selectedMetadata.providerGroup,
    })
  })

  const handleDeleteSession = React.useEffectEvent(async (sessionId: string) => {
    const path =
      typeof window !== "undefined" ? window.location.pathname : ""
    const parsed = parseRepoPathname(path)
    const pool = !parsed
      ? props.sessions
      : props.sessions.filter(
          (session) =>
            session.repoSource?.owner === parsed.owner &&
            session.repoSource?.repo === parsed.repo
        )
    const remainingSessions = pool.filter(
      (session) => session.id !== sessionId
    )

    try {
      await runtimeClient.releaseSession(sessionId)
    } catch {
      // Worker unavailable or session never attached — still remove local data.
    }

    await deleteSession(sessionId)

    if (sessionId !== selectedSessionId) {
      return
    }

    if (remainingSessions.length > 0) {
      const fallbackSession = remainingSessions[0]
      setSelectedSessionId(fallbackSession.id)
      await persistLastUsedSessionSettings({
        model: fallbackSession.model,
        provider: fallbackSession.provider,
        providerGroup: fallbackSession.providerGroup,
      })
      return
    }

    const baseSession = activeSession ?? props.initialSession
    const repoFromPathForEmpty = parsed
      ? normalizeRepoSource(parsedPathToRepoSource(parsed))
      : undefined

    if (!baseSession) {
      const { model, providerGroup, visibleProviderGroups } =
        await resolveProviderDefaults()
      const nextSession = createSession({
        model,
        providerGroup,
        repoSource: repoFromPathForEmpty,
        thinkingLevel: "medium",
      })
      await persistSessionSnapshot(nextSession)
      const finalized = await persistVisibleSessionSelection(
        nextSession,
        visibleProviderGroups
      )
      setSelectedSessionId(finalized.id)
      await persistLastUsedSessionSettings(finalized)
      return
    }

    const nextSession = createSession({
      model: baseSession.model,
      providerGroup: baseSession.providerGroup ?? baseSession.provider,
      repoSource: repoFromPathForEmpty ?? baseSession.repoSource,
      thinkingLevel: baseSession.thinkingLevel,
    })

    await persistSessionSnapshot(nextSession)
    setSelectedSessionId(nextSession.id)
    await persistLastUsedSessionSettings(nextSession)
  })

  const mainContext: ChatShellMainContext = {
    activeSession,
    displayedIsStreaming,
    messages,
    openSettings: props.openSettings,
    runtime,
    selectedSessionId,
  }

  return (
    <SidebarProvider>
      <div className="relative flex h-svh w-full overflow-hidden overscroll-none">
        <ChatSidebar
          activeSessionId={selectedSessionId}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onSelectSession={handleSelectSession}
          runningSessionIds={runningSessionIds}
          sessions={sessionsInRepo}
        />
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChatHeader
            onOpenSettings={() => props.openSettings("providers")}
            settingsDisabled={displayedIsStreaming}
          />
          <main className="flex min-h-0 flex-1 overflow-hidden">
            {props.renderMain(mainContext)}
          </main>
        </SidebarInset>
      </div>
      <SettingsDialog
        initialSection={props.settingsSection}
        onGithubTokenSaved={() => {
          if (selectedSessionId) {
            void runtimeClient.refreshGithubToken(selectedSessionId)
          }
        }}
        onOpenChange={props.setSettingsOpen}
        open={props.settingsOpen}
        session={activeSession}
        settingsDisabled={displayedIsStreaming}
      />
    </SidebarProvider>
  )
}

export function ChatShell() {
  const bootstrap = useAppBootstrap()
  const { sessions } = useSessionList()
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settingsSection, setSettingsSection] =
    React.useState<SettingsSection>("providers")

  const openSettings = React.useCallback(
    (section: SettingsSection = "providers") => {
      setSettingsSection(section)
      setSettingsOpen(true)
    },
    []
  )

  if (bootstrap.status === "error") {
    return (
      <div className="flex min-h-svh items-center justify-center px-6 text-sm text-destructive">
        {bootstrap.error}
      </div>
    )
  }

  if (bootstrap.status === "loading" || !bootstrap.session) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading local session state...
      </div>
    )
  }

  return (
    <ChatShellChrome
      initialSession={bootstrap.session}
      openSettings={openSettings}
      sessions={sessions}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      settingsSection={settingsSection}
      renderMain={({
        activeSession: session,
        displayedIsStreaming,
        messages: sessionMessages,
        openSettings: openSettingsFromChrome,
        runtime: sessionRuntime,
      }) =>
        session ? (
          <Chat
            error={sessionRuntime.error ?? session.error}
            messages={sessionMessages}
            onOpenGithubSettings={() => openSettingsFromChrome("github")}
            runtime={sessionRuntime}
            session={{
              ...session,
              isStreaming: displayedIsStreaming,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
            Loading session...
          </div>
        )
      }
    />
  )
}
