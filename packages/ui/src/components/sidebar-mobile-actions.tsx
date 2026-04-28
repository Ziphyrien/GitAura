"use client";

import { Link } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { Icons } from "@webaura/ui/components/icons";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@webaura/ui/components/sidebar";
import { GITHUB_APP_REPO } from "@webaura/pi/hooks/use-github-repo-stargazers";

type ThemePreference = "light" | "dark" | "system";

const THEME_LABELS: Record<ThemePreference, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

function normalizeTheme(theme: string | undefined): ThemePreference {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
}

function getNextTheme(theme: ThemePreference): ThemePreference {
  if (theme === "light") {
    return "dark";
  }
  if (theme === "dark") {
    return "system";
  }
  return "light";
}

/** Mobile sidebar only: links and actions that are hidden from the header on small screens. */
export function SidebarMobileActions() {
  const { setTheme, theme } = useTheme();
  const currentTheme = normalizeTheme(theme);
  const nextTheme = getNextTheme(currentTheme);

  return (
    <div className="md:hidden">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="h-9 gap-1.5">
            <a
              href={`https://github.com/${GITHUB_APP_REPO.owner}/${GITHUB_APP_REPO.repo}`}
              rel="noreferrer"
              target="_blank"
            >
              <Icons.gitHub className="text-sidebar-foreground" />
              <span>GitHub</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton className="h-9" onClick={() => setTheme(nextTheme)}>
            <span className="relative flex size-4 shrink-0 items-center justify-center">
              {currentTheme === "system" ? (
                <Icons.monitor className="size-4 text-sidebar-foreground" />
              ) : (
                <>
                  <Icons.sun className="size-4 rotate-0 scale-100 text-sidebar-foreground transition-all dark:-rotate-90 dark:scale-0" />
                  <Icons.moon className="absolute size-4 rotate-90 scale-0 text-sidebar-foreground transition-all dark:rotate-0 dark:scale-100" />
                </>
              )}
            </span>
            <span className="truncate">Theme: {THEME_LABELS[currentTheme]}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="h-9">
            <Link
              search={(prev) => ({
                ...prev,
                settings: "providers",
              })}
              to="."
            >
              <Icons.cog className="text-sidebar-foreground" />
              <span>Settings</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}
