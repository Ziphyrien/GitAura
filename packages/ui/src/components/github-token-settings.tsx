import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import {
  GITHUB_CREATE_PAT_URL,
  getGithubPersonalAccessToken,
  setGithubPersonalAccessToken,
  validateGithubPersonalAccessToken,
} from "@webaura/pi/repo/github-token";
import { toast } from "sonner";
import { Button } from "@webaura/ui/components/button";
import { Input } from "@webaura/ui/components/input";
import { Label } from "@webaura/ui/components/label";
import { cn } from "@webaura/ui/lib/utils";

export function GithubTokenSettings(props: {
  disabled?: boolean;
  onTokenSaved?: () => void | Promise<void>;
}) {
  const [token, setToken] = React.useState("");
  const [hasSavedToken, setHasSavedToken] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    let disposed = false;

    void (async () => {
      const stored = await getGithubPersonalAccessToken();

      if (disposed) {
        return;
      }

      const present = Boolean(stored?.trim());
      setToken(stored ?? "");
      setHasSavedToken(present);
      setIsLoading(false);
    })();

    return () => {
      disposed = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-none border border-dashed border-foreground/15 p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">Use a GitHub Personal Access Token</div>
          <p className="text-xs text-muted-foreground">
            Optional. Store a token locally for future GitHub modules or extensions. The default
            chat experience does not use GitHub access.
          </p>
        </div>

        {!isLoading && !hasSavedToken ? (
          <Button
            className="mt-4 h-8 w-full gap-1 text-xs sm:w-auto"
            disabled={props.disabled || isSaving}
            onClick={() => {
              window.open(GITHUB_CREATE_PAT_URL, "_blank", "noopener,noreferrer");
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Generate Personal Access Token
            <ArrowUpRight className="size-3.5 opacity-70" />
          </Button>
        ) : null}

        <div className={cn("space-y-2", !isLoading && !hasSavedToken ? "mt-3" : "mt-4")}>
          <Label htmlFor="github-pat">GitHub Personal Access Token</Label>
          <Input
            autoComplete="off"
            disabled={props.disabled || isLoading || isSaving}
            id="github-pat"
            onChange={(event) => setToken(event.target.value)}
            placeholder="github_pat_..."
            type="password"
            value={token}
          />
          <p className="text-xs text-muted-foreground">Stored only in this browser.</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            disabled={props.disabled || isLoading || isSaving}
            onClick={async () => {
              const next = token.trim();
              setIsSaving(true);
              try {
                if (!next) {
                  setToken("");
                  await setGithubPersonalAccessToken(undefined);
                  setHasSavedToken(false);
                  toast.success("Personal Access Token deleted");
                  await props.onTokenSaved?.();
                  return;
                }

                const result = await validateGithubPersonalAccessToken(next);
                if (!result.ok) {
                  toast.error(result.message);
                  return;
                }

                await setGithubPersonalAccessToken(next);
                setHasSavedToken(true);
                toast.success(`Personal Access Token saved for @${result.login}`);
                await props.onTokenSaved?.();
              } catch {
                toast.error("Could not save Personal Access Token");
              } finally {
                setIsSaving(false);
              }
            }}
            size="sm"
            type="button"
          >
            Save Personal Access Token
          </Button>
          {!isLoading && hasSavedToken ? (
            <Button
              disabled={props.disabled || isSaving}
              onClick={async () => {
                setIsSaving(true);
                try {
                  setToken("");
                  await setGithubPersonalAccessToken(undefined);
                  setHasSavedToken(false);
                  toast.success("Personal Access Token deleted");
                  await props.onTokenSaved?.();
                } catch {
                  toast.error("Could not delete Personal Access Token");
                } finally {
                  setIsSaving(false);
                }
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Delete Personal Access Token
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
