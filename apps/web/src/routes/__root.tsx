import * as React from "react";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  retainSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";
import { Analytics as OneDollarStats } from "@/components/analytics";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { RootGuard } from "@/components/root-guard";
import { parseSettingsSection } from "@webaura/ui/lib/search-state";
import { SidebarInset, SidebarProvider } from "@webaura/ui/components/sidebar";
import { AppSettingsDialog } from "@webaura/ui/components/settings-dialog";
import { ThemeProvider } from "@webaura/ui/components/theme-provider";
import { Toaster } from "@webaura/ui/components/sonner";
import { TooltipProvider } from "@webaura/ui/components/tooltip";
import appCss from "../styles.css?url";

type RootSearchInput = {
  settings?: string;
  sidebar?: string;
};

type RootSearch = {
  settings?: ReturnType<typeof parseSettingsSection>;
  sidebar?: "open";
};

export const Route = createRootRoute({
  validateSearch: (search: RootSearchInput): RootSearch => ({
    settings: parseSettingsSection(search.settings),
    sidebar: search.sidebar === "open" ? "open" : undefined,
  }),
  search: {
    middlewares: [retainSearchParams(["settings", "sidebar"])],
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "WebAura",
      },
      {
        name: "description",
        content: "Local-first AI tools, running in your browser.",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "WebAura",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon-96x96.png",
        sizes: "96x96",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "shortcut icon",
        href: "/favicon.ico",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/site.webmanifest",
      },
    ],
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
  component: RootAppChrome,
  ssr: false,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
        <Scripts />
        <VercelAnalytics />
        <OneDollarStats />
      </body>
    </html>
  );
}

function RootAppChrome() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  return (
    <>
      <RootGuard>
        <SidebarProvider
          onOpenChange={(open) => {
            void navigate({
              search: (prev) => ({
                ...prev,
                sidebar: open ? "open" : undefined,
              }),
              to: ".",
            });
          }}
          open={search.sidebar === "open"}
        >
          <div className="relative flex h-svh w-full overflow-hidden overscroll-none">
            <AppSidebar />
            <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <AppHeader />
              <main className="flex min-h-0 flex-1 overflow-hidden">
                <Outlet />
              </main>
            </SidebarInset>
          </div>
          <AppSettingsDialog />
        </SidebarProvider>
      </RootGuard>
      <Toaster position="bottom-right" />
    </>
  );
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-medium">Page not found</h1>
      <p className="max-w-md text-xs text-muted-foreground">
        The route does not exist or the dev server reloaded while the router was resolving the page.
      </p>
      <Link
        className="text-xs underline underline-offset-4 hover:text-foreground"
        search={{
          settings: undefined,
          sidebar: undefined,
        }}
        to="/"
      >
        Go back home
      </Link>
    </div>
  );
}
