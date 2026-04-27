import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import type { ProviderGroupId, ProviderId } from "@gitaura/pi/types/models";
import {
  disconnectProvider,
  getOAuthProviderName,
  loginAndStoreOAuthProvider,
  setProviderApiKey,
  type OAuthProviderId,
} from "@gitaura/pi/auth/auth-service";
import { isOAuthCredentials } from "@gitaura/pi/auth/oauth-types";
import { db } from "@gitaura/db";
import {
  getOAuthProvidersForSettings,
  getProviderGroupMetadata,
  getSortedApiKeyProvidersForSettings,
} from "@gitaura/pi/models/provider-registry";
import {
  DEFAULT_PROXY_URL,
  PROXY_ENABLED_KEY,
  PROXY_URL_KEY,
  proxyConfigFromSettingsRows,
} from "@gitaura/pi/proxy/settings";
import { Button } from "@gitaura/ui/components/button";
import { Input } from "@gitaura/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@gitaura/ui/components/item";

type DeviceCodePrompt = {
  userCode: string;
  verificationUri: string;
};

function isOAuthConnected(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed && isOAuthCredentials(trimmed));
}

function apiKeyProviderLabel(provider: ProviderId): string {
  return getProviderGroupMetadata(provider as ProviderGroupId).label;
}

function hasStoredPlainApiKey(
  providerKeys: { provider: ProviderId; value: string }[],
  provider: ProviderId,
): boolean {
  const record = providerKeys.find((item) => item.provider === provider);
  const trimmed = record?.value?.trim() ?? "";
  return Boolean(trimmed && !trimmed.startsWith("{"));
}

export function ProviderSettings(props: { onNavigateToProxy?: () => void }) {
  const providerKeys = useLiveQuery(() => db.providerKeys.toArray(), []) ?? [];
  const proxySettingRows = useLiveQuery(() =>
    db.settings.where("key").anyOf([PROXY_ENABLED_KEY, PROXY_URL_KEY]).toArray(),
  );

  const proxyConfig = React.useMemo(() => {
    if (proxySettingRows) {
      return proxyConfigFromSettingsRows(proxySettingRows);
    }

    return {
      enabled: true,
      url: DEFAULT_PROXY_URL,
    };
  }, [proxySettingRows]);

  const [draftValues, setDraftValues] = React.useState<Partial<Record<ProviderId, string>>>({});
  const [devicePrompts, setDevicePrompts] = React.useState<
    Partial<Record<OAuthProviderId, DeviceCodePrompt>>
  >({});
  const [loginErrors, setLoginErrors] = React.useState<Partial<Record<OAuthProviderId, string>>>(
    {},
  );
  const [loggingInProvider, setLoggingInProvider] = React.useState<OAuthProviderId | undefined>();

  React.useEffect(() => {
    setDraftValues(
      Object.fromEntries(
        providerKeys.map((record) => [
          record.provider,
          record.value.trim().startsWith("{") ? "" : record.value,
        ]),
      ) as Partial<Record<ProviderId, string>>,
    );
  }, [providerKeys]);

  const apiKeyProviders = React.useMemo(() => getSortedApiKeyProvidersForSettings(), []);

  const subscriptionOAuthProviders = React.useMemo(() => getOAuthProvidersForSettings(), []);

  const handleOAuthLogin = async (provider: OAuthProviderId) => {
    setLoggingInProvider(provider);
    setLoginErrors((current) => ({
      ...current,
      [provider]: undefined,
    }));
    setDevicePrompts((current) => ({
      ...current,
      [provider]: undefined,
    }));

    try {
      await loginAndStoreOAuthProvider(
        provider,
        new URL("/auth/callback", window.location.origin).toString(),
        (info) => {
          setDevicePrompts((current) => ({
            ...current,
            [provider]: info,
          }));
        },
        provider === "anthropic" && proxyConfig.enabled ? { proxyUrl: proxyConfig.url } : undefined,
      );
      setDevicePrompts((current) => ({
        ...current,
        [provider]: undefined,
      }));
      toast.success(`Connected to ${getOAuthProviderName(provider)}`);
    } catch (error) {
      setLoginErrors((current) => ({
        ...current,
        [provider]: error instanceof Error ? error.message : "Could not complete sign-in",
      }));
    } finally {
      setLoggingInProvider(undefined);
    }
  };

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">Subscription Login</h3>
          <p className="text-xs text-muted-foreground">
            Connect your existing subscriptions directly in your browser. Tokens are stored locally
            in this browser.
          </p>
        </div>

        <div className="text-xs text-muted-foreground">
          <p>
            Anthropic token exchanges use{" "}
            <span className="font-medium text-foreground">{proxyConfig.url}</span> when proxying is
            enabled. An untrusted proxy can see those credentials.{" "}
            {props.onNavigateToProxy ? (
              <button
                className="font-medium text-foreground underline underline-offset-4 hover:text-foreground"
                onClick={props.onNavigateToProxy}
                type="button"
              >
                Change in Proxy settings.
              </button>
            ) : (
              <span>Change in Proxy settings.</span>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {subscriptionOAuthProviders.map((provider) => {
            const record = providerKeys.find((item) => item.provider === provider);
            const connected = isOAuthConnected(record?.value);
            const devicePrompt = devicePrompts[provider];
            const loginError = loginErrors[provider];
            const loggingIn = loggingInProvider === provider;

            return (
              <div className="space-y-2" key={provider}>
                <Item className="items-start" variant="outline">
                  <ItemContent>
                    <ItemTitle className="text-sm font-medium text-foreground">
                      {getOAuthProviderName(provider)}
                    </ItemTitle>
                    <ItemDescription>
                      {connected
                        ? "Connected"
                        : "Open a provider sign-in window and store the token locally."}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto shrink-0">
                    {connected ? (
                      <Button
                        onClick={async () => {
                          try {
                            await disconnectProvider(provider);
                            toast.success(`${getOAuthProviderName(provider)} disconnected`);
                          } catch {
                            toast.error("Could not disconnect");
                          }
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        disabled={loggingInProvider !== undefined && !loggingIn}
                        onClick={() => void handleOAuthLogin(provider)}
                        size="sm"
                        variant="secondary"
                      >
                        {loggingIn ? "Signing in..." : "Sign in"}
                      </Button>
                    )}
                  </ItemActions>
                </Item>

                {!connected && devicePrompt ? (
                  <Item className="items-start" variant="muted">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="text-sm font-medium text-foreground">
                        Complete device sign-in
                      </ItemTitle>
                      <ItemDescription>
                        Enter code{" "}
                        <code className="border border-border bg-background px-1.5 py-0.5 font-mono text-foreground">
                          {devicePrompt.userCode}
                        </code>{" "}
                        at{" "}
                        <a
                          className="font-medium text-foreground underline underline-offset-4"
                          href={devicePrompt.verificationUri}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {devicePrompt.verificationUri}
                        </a>
                        .
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ) : null}

                {loginError ? <div className="text-xs text-destructive">{loginError}</div> : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">API Keys</h3>
          <p className="text-xs text-muted-foreground">
            Enter API keys for cloud providers. Keys are stored locally in your browser.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {apiKeyProviders.map((provider) => {
            const keySaved = hasStoredPlainApiKey(providerKeys, provider);

            return (
              <div className="space-y-2" key={provider}>
                <div className="text-sm font-medium text-foreground">
                  {apiKeyProviderLabel(provider)}
                </div>
                <div className="flex gap-2">
                  <Input
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    onChange={(event) =>
                      setDraftValues((current) => ({
                        ...current,
                        [provider]: event.target.value,
                      }))
                    }
                    placeholder="Enter API key"
                    type="password"
                    value={draftValues[provider] ?? ""}
                  />
                  {keySaved ? (
                    <Button
                      className="shrink-0"
                      onClick={async () => {
                        try {
                          await disconnectProvider(provider);
                          toast.success(`${apiKeyProviderLabel(provider)} API key removed`);
                        } catch {
                          toast.error("Could not remove API key");
                        }
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Clear
                    </Button>
                  ) : (
                    <Button
                      className="shrink-0"
                      onClick={async () => {
                        const value = draftValues[provider]?.trim();

                        if (!value) {
                          toast.warning("Enter an API key first");
                          return;
                        }

                        try {
                          await setProviderApiKey(provider, value);
                          toast.success(`${apiKeyProviderLabel(provider)} API key saved`);
                        } catch {
                          toast.error("Could not save API key");
                        }
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      Save
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
