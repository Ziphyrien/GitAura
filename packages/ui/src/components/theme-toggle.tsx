"use client";

import { useTheme } from "next-themes";

import { Button } from "@webaura/ui/components/button";
import { Icons } from "@webaura/ui/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@webaura/ui/components/tooltip";

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

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const currentTheme = normalizeTheme(theme);
  const nextTheme = getNextTheme(currentTheme);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={`Theme: ${THEME_LABELS[currentTheme]}. Switch to ${THEME_LABELS[nextTheme]}`}
          className="relative"
          size="icon"
          variant="ghost"
          onClick={() => setTheme(nextTheme)}
        >
          {currentTheme === "system" ? (
            <Icons.monitor className="text-foreground" />
          ) : (
            <>
              <Icons.sun className="rotate-0 scale-100 text-foreground transition-all dark:-rotate-90 dark:scale-0" />
              <Icons.moon className="absolute rotate-90 scale-0 text-foreground transition-all dark:rotate-0 dark:scale-100" />
            </>
          )}
          <span className="sr-only">Switch Theme</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>Theme: {THEME_LABELS[currentTheme]}</TooltipContent>
    </Tooltip>
  );
}
