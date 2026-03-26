"use client"

import { useNavigate, useSearch } from "@tanstack/react-router"
import { useTheme } from "next-themes"
import { Icons } from "@/components/icons"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useCurrentRouteTarget } from "@/hooks/use-current-route-target"
import { useSelectedSessionSummary } from "@/hooks/use-selected-session-summary"

/** Mobile sidebar only: links and actions that are hidden from the header on small screens. Renders under the Home link. */
export function SidebarMobileActions() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const currentRouteTarget = useCurrentRouteTarget()
  const { setTheme, theme } = useTheme()

  const sidebar = search.sidebar === "open" ? "open" : undefined
  const initialQuery =
    typeof search.initialQuery === "string" ? search.initialQuery : undefined
  const sessionId =
    typeof search.session === "string" ? search.session : undefined
  const selectedSession = useSelectedSessionSummary(sessionId)

  const openSettings = () => {
    if (currentRouteTarget.to === "/") {
      void navigate({
        to: "/",
        search: {
          settings: "providers",
          sidebar,
        },
      })
      return
    }

    void navigate({
      ...currentRouteTarget,
      search: {
        initialQuery,
        session: sessionId,
        settings: "providers",
        sidebar,
      },
    })
  }

  return (
    <div className="md:hidden">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="h-9">
            <a href="https://x.com/dinnaiii" rel="noreferrer" target="_blank">
              <Icons.x className="text-sidebar-foreground" />
              <span>X</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="h-9">
            <a
              href="https://github.com/jeremyosih/gitinspect"
              rel="noreferrer"
              target="_blank"
            >
              <Icons.gitHub className="text-sidebar-foreground" />
              <span>GitHub</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="h-9"
            onClick={() =>
              theme === "light" ? setTheme("dark") : setTheme("light")
            }
          >
            <span className="relative flex size-4 shrink-0 items-center justify-center">
              <Icons.sun className="size-4 rotate-0 scale-100 text-sidebar-foreground transition-all dark:-rotate-90 dark:scale-0" />
              <Icons.moon className="absolute size-4 rotate-90 scale-0 text-sidebar-foreground transition-all dark:rotate-0 dark:scale-100" />
            </span>
            <span className="truncate">Toggle theme</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="h-9"
            disabled={selectedSession?.isStreaming ?? false}
            onClick={openSettings}
          >
            <Icons.cog className="text-sidebar-foreground" />
            <span>Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  )
}
