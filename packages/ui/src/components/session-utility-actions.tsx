import { MoreHorizontal, RefreshCw } from "lucide-react";
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
  isSharing?: boolean;
  onCopy: () => void;
  onShare: () => void;
};

export function SessionUtilityActions(props: SessionUtilityActionProps) {
  return (
    <>
      <div className="hidden items-center gap-2 md:flex">
        <Button
          className={
            props.isSharing
              ? "h-7 gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary shadow-none transition-colors"
              : "h-7 gap-1.5 rounded-sm border border-border/50 bg-muted px-2 py-1 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground"
          }
          disabled={props.disabled || props.isSharing}
          onClick={props.onShare}
          size="sm"
          type="button"
          variant="ghost"
        >
          {props.isSharing ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Icons.globe className="size-3.5" />
          )}
          <span>{props.isSharing ? "Sharing" : "Share"}</span>
        </Button>
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
            <DropdownMenuItem disabled={props.isSharing} onClick={props.onShare}>
              {props.isSharing ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Icons.globe className="size-4" />
              )}
              <span>{props.isSharing ? "Sharing" : "Share"}</span>
            </DropdownMenuItem>
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
