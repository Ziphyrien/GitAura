import { MoreHorizontal } from "lucide-react";
import { Button } from "@webaura/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@webaura/ui/components/dropdown-menu";
import { Icons } from "@webaura/ui/components/icons";

type SessionUtilityActionProps = {
  disabled?: boolean;
  onCopy: () => void;
  onShare?: () => void;
};

export function SessionUtilityActions(props: SessionUtilityActionProps) {
  return (
    <>
      <div className="hidden items-center gap-2 md:flex">
        {props.onShare ? (
          <Button
            className="h-7 gap-1.5 rounded-sm border border-border/50 bg-muted px-2 py-1 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground"
            disabled={props.disabled}
            onClick={props.onShare}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Icons.gitHub className="size-3.5" />
            <span>Share as Gist</span>
          </Button>
        ) : null}
        <Button
          className="h-7 gap-1.5 rounded-sm border border-border/50 bg-muted px-2 py-1 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground"
          disabled={props.disabled}
          onClick={props.onCopy}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Icons.copy className="size-3.5" />
          <span>Copy as Markdown</span>
        </Button>
      </div>

      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Open session actions"
              className="h-8 w-8 rounded-sm"
              disabled={props.disabled}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {props.onShare ? (
              <DropdownMenuItem onClick={props.onShare}>
                <Icons.gitHub className="size-4" />
                <span>Share as Gist</span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={props.onCopy}>
              <Icons.copy className="size-4" />
              <span>Copy as Markdown</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
