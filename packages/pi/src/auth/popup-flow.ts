const POPUP_FEATURES = "popup=yes,width=560,height=760,left=120,top=120";
const CALLBACK_PATHNAME = "/auth/callback";

interface OAuthCallbackMessage {
  error?: string;
  type: "oauth-callback";
  url?: string;
}

function getSameOriginCallbackUrl(input: string | undefined): URL | undefined {
  if (!input) {
    return undefined;
  }

  try {
    const url = new URL(input);
    return url.origin === window.location.origin && url.pathname === CALLBACK_PATHNAME
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export async function runPopupOAuthFlow(authUrl: string): Promise<URL> {
  const popup = window.open(authUrl, "sitegeist-oauth", POPUP_FEATURES);

  if (!popup) {
    throw new Error("Failed to open OAuth popup");
  }

  return await new Promise<URL>((resolve, reject) => {
    let closeObserved = false;
    let settled = false;

    const readSameOriginRedirect = (): URL | undefined => {
      try {
        return getSameOriginCallbackUrl(popup.location.href);
      } catch {
        return undefined;
      }
    };

    const cleanup = () => {
      window.clearInterval(interval);
      window.removeEventListener("message", onMessage);
      popup.close();
    };

    const resolveOnce = (url: URL) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(url);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const onMessage = (event: MessageEvent<OAuthCallbackMessage>) => {
      if (event.origin !== window.location.origin || event.data.type !== "oauth-callback") {
        return;
      }

      if (event.data.error) {
        rejectOnce(new Error(event.data.error));
        return;
      }

      const url = getSameOriginCallbackUrl(event.data.url);
      if (!url) {
        rejectOnce(new Error("OAuth callback did not include a redirect URL"));
        return;
      }

      resolveOnce(url);
    };

    const interval = window.setInterval(() => {
      const redirect = readSameOriginRedirect();
      if (redirect) {
        resolveOnce(redirect);
        return;
      }

      if (!popup.closed || closeObserved) {
        return;
      }

      closeObserved = true;
      window.setTimeout(() => {
        const lateRedirect = readSameOriginRedirect();
        if (lateRedirect) {
          resolveOnce(lateRedirect);
          return;
        }

        rejectOnce(new Error("OAuth popup was closed before completing login"));
      }, 250);
    }, 250);

    window.addEventListener("message", onMessage);
  });
}

export function openPopup(url: string): void {
  window.open(url, "sitegeist-oauth-device", POPUP_FEATURES);
}
