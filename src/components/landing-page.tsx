import * as React from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowRightIcon } from "@phosphor-icons/react"
import { listRecentRepos } from "@/db/schema"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import { useSessionList } from "@/hooks/use-session-list"
import { buildRepoPathname, parseRepoPathname } from "@/repo/url"
import { loadSession } from "@/sessions/session-service"
import {
  ChatShellChrome,
} from "@/components/chat-shell"
import type { SettingsSection } from "@/components/settings-dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Icons } from "@/components/icons"
import { ChatLogo } from "@/components/chat-logo"

function parseRepoQuery(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }

  const slash = trimmed.split("/").filter(Boolean)
  if (
    slash.length === 2 &&
    !trimmed.includes(" ") &&
    !trimmed.startsWith("http")
  ) {
    return parseRepoPathname(`/${slash[0]}/${slash[1]}`)
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    const url = new URL(withProtocol)
    if (!url.hostname.endsWith("github.com")) {
      return undefined
    }

    return parseRepoPathname(url.pathname)
  } catch {
    return undefined
  }
}

export function LandingPage() {
  const bootstrap = useAppBootstrap()
  const { sessions } = useSessionList()
  const firstSessionId = sessions[0]?.id
  const shellSession = useLiveQuery(
    async () => {
      if (bootstrap.session) {
        return bootstrap.session
      }

      if (!firstSessionId) {
        return undefined
      }

      return (await loadSession(firstSessionId)) ?? undefined
    },
    [bootstrap.session?.id, firstSessionId]
  )
  const recentRepos = useLiveQuery(async () => await listRecentRepos(), [])
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

  if (bootstrap.status === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading local session state...
      </div>
    )
  }

  return (
    <ChatShellChrome
      initialSession={shellSession ?? undefined}
      openSettings={openSettings}
      sessions={sessions}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      settingsSection={settingsSection}
      renderMain={() => (
        <div className="flex h-full w-full flex-col items-center justify-center overflow-auto p-6">
          <div className="w-full max-w-xl space-y-8">
            <div className="space-y-6 text-center">
              <h1 className="sr-only">gitinspect</h1>
              <ChatLogo size="hero" aria-hidden />
              <p className="text-xs text-muted-foreground">
                Paste a public GitHub repository URL or{" "}
                <span className="font-mono text-[11px]">owner/repo</span> to open
                it in the workspace.
              </p>
            </div>

            <LandingRepoForm />

            {recentRepos && recentRepos.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recent repositories
                </div>
                <ul className="space-y-1">
                  {recentRepos.map((row) => {
                    const to = buildRepoPathname(
                      row.owner,
                      row.repo,
                      row.ref !== "main" ? row.ref : undefined
                    )
                    return (
                      <li key={`${row.owner}/${row.repo}@${row.ref}`}>
                        <Link
                          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                          to={to}
                        >
                          <span className="font-mono text-xs">
                            {row.owner}/{row.repo}
                            {row.ref !== "main" ? `@${row.ref}` : ""}
                          </span>
                          <ArrowRightIcon
                            className="size-3.5 shrink-0 text-muted-foreground"
                            weight="bold"
                          />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      )}
    />
  )
}

function LandingRepoForm() {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseRepoQuery(query)
    if (!parsed) {
      return
    }

    const path = buildRepoPathname(
      parsed.owner,
      parsed.repo,
      parsed.ref && parsed.ref !== "main" ? parsed.ref : undefined
    )
    void navigate({ to: path })
  }

  return (
    <form onSubmit={onSubmit}>
      <InputGroup className="h-10 w-full min-w-0 rounded-lg">
        <InputGroupAddon align="inline-start" className="pl-3">
          <InputGroupText className="gap-1.5">
            <Icons.gitHub className="size-3" />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          aria-label="GitHub repository URL or owner/repo"
          autoComplete="off"
          className="min-w-0 text-sm"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="https://github.com/owner/repo or owner/repo"
          value={query}
        />
        <InputGroupAddon align="inline-end" className="pr-1">
          <InputGroupButton
            aria-label="Continue to workspace"
            size="icon-sm"
            type="submit"
            variant="ghost"
          >
            <ArrowRightIcon className="size-3.5" weight="bold" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
