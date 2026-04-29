import { SparkleIcon } from "@phosphor-icons/react";
import { CHAT_SUGGESTIONS } from "@webaura/ui/components/chat-suggestions";

export function ChatEmptyState({
  onSuggestionClick,
}: {
  onSuggestionClick: (text: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <h2 className="font-geist-pixel-square text-2xl font-semibold tracking-tight text-foreground">
              Ask plainly.
            </h2>
            <SparkleIcon className="size-6 shrink-0 text-muted-foreground" weight="fill" />
            <h2 className="font-geist-pixel-square text-2xl font-semibold tracking-tight text-muted-foreground">
              Think locally.
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Start a normal AI chat. Your sessions and credentials stay in this browser.
          </p>
        </div>

        <div className="flex w-full flex-col">
          {CHAT_SUGGESTIONS.map((suggestion) => (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
              key={suggestion}
              onClick={() => onSuggestionClick(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
