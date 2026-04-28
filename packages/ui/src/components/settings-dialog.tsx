import * as React from "react";
import { Link, useNavigate, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import type { SettingsSection } from "@webaura/ui/lib/search-state";
import { Icons } from "@webaura/ui/components/icons";
import { CostsPanel } from "@webaura/ui/components/costs-panel";
import { DataSettings } from "@webaura/ui/components/data-settings";
import { GithubTokenSettings } from "@webaura/ui/components/github-token-settings";
import { ProviderSettings } from "@webaura/ui/components/provider-settings";
import { ProxySettings } from "@webaura/ui/components/proxy-settings";
import { Button } from "@webaura/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@webaura/ui/components/dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@webaura/ui/components/breadcrumb";
import { Tabs, TabsList, TabsTrigger } from "@webaura/ui/components/tabs";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@webaura/ui/components/sidebar";
import { isSettingsSection } from "@webaura/ui/lib/search-state";
import { useSelectedSessionSummary } from "@webaura/pi/hooks/use-selected-session-summary";

type SettingsSectionItem = {
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  id: SettingsSection;
  label: string;
};

const SETTINGS_SECTIONS: Array<SettingsSectionItem> = [
  {
    description: "LLM API keys and OAuth credentials stored in this browser",
    icon: Icons.badgeCheck,
    id: "providers",
    label: "Providers",
  },
  {
    description: "GitHub token for private repositories and higher API limits",
    icon: Icons.gitHub,
    id: "github",
    label: "GitHub",
  },
  {
    description: "Session and daily usage totals",
    icon: Icons.cost,
    id: "costs",
    label: "Costs",
  },
  {
    description: "Optional proxy routing for provider requests",
    icon: Icons.globe,
    id: "proxy",
    label: "Proxy",
  },
  {
    description: "Export chat or wipe all local app data",
    icon: Icons.bank,
    id: "data",
    label: "Data",
  },
  {
    description: "How WebAura runs browser-native AI modules locally",
    icon: Icons.faceThinking,
    id: "about",
    label: "About",
  },
];

export function AppSettingsDialog(props: {
  dataPanel?: React.ReactNode;
  pricingLabel?: string;
  pricingPanel?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ strict: false });
  const currentMatch = useRouterState({
    select: (state) => state.matches[state.matches.length - 1],
  });
  const sessionId =
    currentMatch.routeId === "/chat/$sessionId" ? currentMatch.params.sessionId : undefined;
  const session = useSelectedSessionSummary(sessionId);
  const requestedSection =
    typeof search.settings === "string" && isSettingsSection(search.settings)
      ? search.settings
      : undefined;
  const section =
    requestedSection && SETTINGS_SECTIONS.some((item) => item.id === requestedSection)
      ? requestedSection
      : "providers";
  const open = Boolean(requestedSection) && SETTINGS_SECTIONS.some((item) => item.id === section);
  const activeSection =
    SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];

  const navigateWithSettings = (nextSection: SettingsSection | undefined) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        settings: nextSection,
      }),
      to: ".",
    });
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          navigateWithSettings(undefined);
        }
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[90dvh] min-h-0 w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(100%-2rem,36rem)] md:h-[620px] md:max-h-[620px] md:min-h-[620px] md:max-w-5xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <SidebarProvider className="flex min-h-0 min-w-0 flex-1 flex-row items-stretch overflow-hidden md:h-full md:min-h-0">
          <Sidebar
            className="hidden border-r border-foreground/10 md:flex md:h-full md:min-h-0 md:self-stretch"
            collapsible="none"
          >
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SETTINGS_SECTIONS.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton asChild isActive={section === item.id}>
                          <Link
                            search={(prev) => ({
                              ...prev,
                              settings: item.id,
                            })}
                            to="."
                          >
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:min-h-0">
            <header className="shrink-0 border-b border-foreground/10 px-5 pt-4 md:h-16 md:pt-0">
              <div className="flex min-h-11 items-center">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbPage>Settings</BreadcrumbPage>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeSection.label}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              <Tabs className="gap-0 md:hidden" value={section}>
                <div className="w-full min-w-0 touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
                  <TabsList
                    className="inline-flex h-auto w-max flex-nowrap justify-start gap-4 bg-transparent p-0 px-1 data-[variant=line]:gap-4"
                    variant="line"
                  >
                    {SETTINGS_SECTIONS.map((item) => (
                      <TabsTrigger
                        asChild
                        className="flex-none gap-1.5 px-1.5 pb-2"
                        key={item.id}
                        value={item.id}
                      >
                        <Link
                          search={(prev) => ({
                            ...prev,
                            settings: item.id,
                          })}
                          to="."
                        >
                          <item.icon className="size-4 shrink-0" />
                          {item.label}
                        </Link>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              </Tabs>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mb-4 max-w-2xl">
                <div className="text-sm font-medium">{activeSection.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {activeSection.description}
                </div>
              </div>
              <div className="max-w-3xl">
                {section === "providers" ? (
                  <ProviderSettings
                    onNavigateToProxy={() => {
                      navigateWithSettings("proxy");
                    }}
                  />
                ) : null}
                {section === "github" ? (
                  <GithubTokenSettings
                    onTokenSaved={async () => {
                      await router.invalidate();
                    }}
                  />
                ) : null}
                {section === "proxy" ? <ProxySettings /> : null}
                {section === "costs" ? <CostsPanel session={session} /> : null}
                {section === "data" ? (props.dataPanel ?? <DataSettings />) : null}
                {section === "about" ? <AboutPanel /> : null}
              </div>
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

const ABOUT_SOURCE_REPO_URL = "https://github.com/Ziphyrien/WebAura";

function AboutPanel() {
  return (
    <div className="space-y-5">
      <div className="space-y-5 text-sm leading-relaxed">
        <p className="text-foreground">
          WebAura is a local-first AI workspace that runs in your browser. GitHub repo chat is the
          current built-in module; the product surface is designed to grow into switchable
          browser-native modules while keeping your own credentials in your own browser.
        </p>

        <div>
          <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Privacy
          </div>
          <div className="space-y-2 text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Local by default.</span> Chats,
              sessions, settings, provider keys, GitHub tokens, and usage data stay in this browser.
            </p>
            <p>
              <span className="font-medium text-foreground">Network:</span> Modules call the
              services they are built for. The current GitHub module queries GitHub from your
              browser for repository data. Model requests go directly to the providers you
              configure, unless you explicitly enable your own proxy in settings.
            </p>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Models and modules
          </div>
          <div className="overflow-x-auto rounded-none border border-border/80 text-xs">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/80 bg-muted/30">
                  <th className="px-3 py-2 font-medium text-foreground">Setting</th>
                  <th className="px-3 py-2 font-medium text-foreground">What it is for</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <td className="px-3 py-2 font-medium text-foreground">Providers</td>
                  <td className="px-3 py-2">
                    API keys and OAuth credentials for the models you use.
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-foreground">GitHub</td>
                  <td className="px-3 py-2">
                    Optional PAT for the GitHub module, stored only here for higher API limits,
                    private repository access, and gist sharing.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Analytics
          </div>
          <p className="text-muted-foreground">
            Vercel and OneDollar Stats are used only for aggregate traffic measurement. They are not
            used to inspect your chats or repository content.
          </p>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            How it works
          </div>
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Research agent</span> - Pick a
              repository and chat in natural language; answers are grounded in the code.
            </li>
            <li>
              <span className="font-medium text-foreground">Stack</span> - pi-mono with direct
              GitHub API access for repository content.
            </li>
            <li>
              <span className="font-medium text-foreground">Local first</span> - The agent runs in a
              per-tab dedicated worker; durable state stays on the main thread.
            </li>
            <li>
              <span className="font-medium text-foreground">Resilient</span> - Lease ownership,
              recovery, and interrupted-turn repair stay inside the browser runtime.
            </li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          Unauthenticated GitHub API requests are limited to 60 per hour; authenticated requests get
          5,000 per hour. Add a token under GitHub settings to raise limits.
        </p>
      </div>

      <Button asChild className="gap-2" variant="outline">
        <a href={ABOUT_SOURCE_REPO_URL} rel="noreferrer" target="_blank">
          <Icons.gitHub className="size-4" />
          View source on GitHub
        </a>
      </Button>
    </div>
  );
}
