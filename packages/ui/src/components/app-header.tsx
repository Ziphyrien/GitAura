import { Link } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@webaura/ui/components/breadcrumb";
import { Button } from "@webaura/ui/components/button";
import { ChatLogo } from "@webaura/ui/components/chat-logo";
import { Icons } from "@webaura/ui/components/icons";
import { Separator } from "@webaura/ui/components/separator";
import { SidebarTrigger } from "@webaura/ui/components/sidebar";
import { ThemeToggle } from "@webaura/ui/components/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@webaura/ui/components/tooltip";

function HeaderTooltip({ children, label }: { children: React.ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <HeaderTooltip label="Toggle sidebar">
          <SidebarTrigger />
        </HeaderTooltip>
        <Separator className="mr-2 !h-7 !self-center" orientation="vertical" />
        <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
          <BreadcrumbList className="w-full min-w-0 flex-nowrap justify-start text-sm sm:text-base">
            <BreadcrumbItem className="max-w-full min-w-0 flex-1">
              <BreadcrumbPage className="block max-w-full min-w-0 p-0">
                <ChatLogo className="w-auto min-w-0 justify-start" truncate />
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex items-center gap-2 px-3 md:hidden">
        <Button
          asChild
          aria-label="Open settings"
          className="h-8 shadow-none"
          size="icon-sm"
          variant="ghost"
        >
          <Link
            search={(prev) => ({
              ...prev,
              settings: "providers",
            })}
            to="."
          >
            <Icons.cog className="text-foreground" />
          </Link>
        </Button>
      </div>
      <div className="hidden items-center gap-2 px-3 md:flex">
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <ThemeToggle />
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <HeaderTooltip label="Open settings">
          <Button
            asChild
            aria-label="Open settings"
            className="h-8 shadow-none"
            size="icon-sm"
            variant="ghost"
          >
            <Link
              search={(prev) => ({
                ...prev,
                settings: "providers",
              })}
              to="."
            >
              <Icons.cog className="text-foreground" />
            </Link>
          </Button>
        </HeaderTooltip>
      </div>
    </header>
  );
}
