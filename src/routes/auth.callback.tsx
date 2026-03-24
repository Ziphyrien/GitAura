import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
})

export function AuthCallbackPage() {
  React.useEffect(() => {
    window.opener?.postMessage(
      {
        type: "oauth-callback",
        url: window.location.href,
      },
      window.location.origin
    )
    window.close()
  }, [])

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6 text-sm text-muted-foreground">
      Completing login...
    </div>
  )
}
