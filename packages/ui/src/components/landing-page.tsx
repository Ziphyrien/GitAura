import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { ChatLogo } from "@webaura/ui/components/chat-logo";
import { Button } from "@webaura/ui/components/button";

export function LandingPage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center overflow-auto p-6 pt-[12vh] lg:justify-between lg:overflow-hidden lg:pt-6 lg:pb-5">
      <div className="w-full max-w-xl flex-1 space-y-8 lg:flex lg:min-h-0 lg:flex-col lg:justify-center lg:space-y-5">
        <div className="space-y-6 text-center lg:space-y-4">
          <h1 className="sr-only">WebAura</h1>
          <ChatLogo
            aria-hidden
            className="[&_.font-geist-pixel-square]:lg:text-7xl [&_.font-geist-pixel-square]:xl:text-8xl"
            size="hero"
          />
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Local-first AI tools, running in your browser. Start with a normal chat.
          </p>
        </div>

        <div className="flex justify-center">
          <Button asChild className="rounded-none" size="lg">
            <Link to="/chat">
              Start chatting
              <ArrowRightIcon className="size-4" weight="bold" />
            </Link>
          </Button>
        </div>
      </div>

      <footer className="mt-auto w-full max-w-xl shrink-0 pt-16 pb-8 text-center lg:mt-0 lg:pt-4 lg:pb-0">
        <p className="text-sm text-muted-foreground">Made by 𝒁𝒊𝒑𝒉𝒚𝒓𝒊𝒆𝒏</p>
        <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-muted-foreground/70">
          This page respects your privacy by not collecting personal information.
        </p>
      </footer>
    </div>
  );
}
