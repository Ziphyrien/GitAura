import * as React from "react";

export function AuthCallbackPage() {
  React.useEffect(() => {
    const message = {
      type: "oauth-callback",
      url: window.location.href,
    };

    const postCallback = () => {
      window.opener?.postMessage(message, window.location.origin);
    };

    postCallback();
    const interval = window.setInterval(postCallback, 100);
    const closeTimeout = window.setTimeout(() => {
      window.clearInterval(interval);
      window.close();
    }, 750);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(closeTimeout);
    };
  }, []);

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6 text-sm text-muted-foreground">
      Completing login...
    </div>
  );
}
