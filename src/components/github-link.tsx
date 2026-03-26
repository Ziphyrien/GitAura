import * as React from "react"

import { Icons } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"

export function GitHubLink() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild className="h-8 shadow-none" size="sm" variant="ghost">
          <a
            aria-label="gitinspect on GitHub"
            href="https://github.com/gitinspect"
            rel="noreferrer"
            target="_blank"
          >
            <Icons.gitHub className="text-foreground" />
            <React.Suspense fallback={<Skeleton className="h-4 w-8" />}>
              <StarsCount />
            </React.Suspense>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>gitinspect on GitHub</TooltipContent>
    </Tooltip>
  )
}

function StarsCount() {
  return <span className="w-fit text-xs tabular-nums text-muted-foreground">0</span>
}
