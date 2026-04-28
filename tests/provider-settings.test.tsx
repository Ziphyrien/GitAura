import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type ProviderKeyRecord = {
  provider: string;
  value: string;
};

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
const loginAndStoreOAuthProvider = vi.fn();
const setProviderApiKey = vi.fn();

const state = vi.hoisted(() => ({
  failLogin: false,
  geminiRequiresProject: false,
  holdLogin: false,
  requireManualRedirect: false,
  providerKeys: [] as ProviderKeyRecord[],
  settingsRows: [] as Array<{ key: string; value: string }>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: toastSuccess,
    warning: toastWarning,
  },
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));

vi.mock("@gitaura/db", () => ({
  db: {
    providerKeys: {
      toArray: () => state.providerKeys,
    },
    settings: {
      where: () => ({
        anyOf: () => ({
          toArray: () => state.settingsRows,
        }),
      }),
    },
  },
}));

vi.mock("@gitaura/pi/models/provider-registry", () => ({
  getOAuthProvidersForSettings: () => [
    "anthropic",
    "github-copilot",
    "google-gemini-cli",
    "openai-codex",
  ],
  getProviderGroupMetadata: (provider: string) => ({
    label:
      provider === "anthropic"
        ? "Anthropic"
        : provider === "github-copilot"
          ? "GitHub Copilot"
          : provider === "google-gemini-cli"
            ? "Google Gemini CLI"
            : provider === "openai-codex"
              ? "OpenAI Codex"
              : provider,
  }),
  getSortedApiKeyProvidersForSettings: () => [] as string[],
}));

vi.mock("@gitaura/pi/proxy/settings", () => ({
  DEFAULT_PROXY_URL: "https://proxy.example/proxy",
  PROXY_ENABLED_KEY: "proxy-enabled",
  PROXY_URL_KEY: "proxy-url",
  proxyConfigFromSettingsRows: () => ({
    enabled: true,
    url: "https://proxy.example/proxy",
  }),
}));

vi.mock("@gitaura/pi/auth/oauth-types", () => ({
  isOAuthCredentials: (value: string) => value.trim().startsWith("{"),
}));

vi.mock("@gitaura/pi/auth/auth-service", () => ({
  disconnectProvider: async (provider: string) => {
    state.providerKeys = state.providerKeys.filter((record) => record.provider !== provider);
  },
  getOAuthProviderName: (provider: string) => {
    switch (provider) {
      case "anthropic":
        return "Anthropic (Claude Pro/Max)";
      case "github-copilot":
        return "GitHub Copilot";
      case "google-gemini-cli":
        return "Google Gemini";
      case "openai-codex":
        return "OpenAI Codex";
      default:
        return provider;
    }
  },
  loginAndStoreOAuthProvider: async (
    provider: string,
    redirectUri: string,
    onDeviceCode?: (info: { userCode: string; verificationUri: string }) => void,
    options?: {
      googleProjectId?: string;
      onManualRedirect?: (request: {
        authUrl: string;
        instructions: string;
        placeholder: string;
        provider: string;
      }) => Promise<string>;
      proxyUrl?: string;
    },
  ) => {
    loginAndStoreOAuthProvider(provider, redirectUri, options);

    if (provider === "github-copilot") {
      onDeviceCode?.({
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
      });
    }

    if (state.requireManualRedirect && (provider === "anthropic" || provider === "openai-codex")) {
      await options?.onManualRedirect?.({
        authUrl: "https://provider.example/auth",
        instructions: "Paste the full redirect URL here.",
        placeholder: "http://localhost/callback",
        provider,
      });
    }

    if (
      state.geminiRequiresProject &&
      provider === "google-gemini-cli" &&
      !options?.googleProjectId
    ) {
      throw new Error("This Google account requires a Google Cloud project ID.");
    }

    if (state.failLogin) {
      throw new Error("OAuth failed");
    }

    if (state.holdLogin) {
      return await new Promise(() => {});
    }

    const value = JSON.stringify({
      access: `${provider}-access`,
      expires: Date.now() + 60_000,
      providerId: provider,
      refresh: `${provider}-refresh`,
    });
    state.providerKeys = [
      ...state.providerKeys.filter((record) => record.provider !== provider),
      {
        provider,
        value,
      },
    ];

    return JSON.parse(value);
  },
  setProviderApiKey,
}));

vi.mock("@gitaura/ui/components/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) =>
    React.createElement(
      "button",
      {
        disabled,
        onClick,
        type: type ?? "button",
      },
      children,
    ),
}));

vi.mock("@gitaura/ui/components/input", () => ({
  Input: ({ value, onChange, placeholder, type }: React.ComponentProps<"input">) =>
    React.createElement("input", { onChange, placeholder, type, value }),
}));

vi.mock("@gitaura/ui/components/item", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children);

  return {
    Item: Passthrough,
    ItemActions: Passthrough,
    ItemContent: Passthrough,
    ItemDescription: Passthrough,
    ItemTitle: Passthrough,
  };
});

describe("provider settings", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    toastWarning.mockReset();
    loginAndStoreOAuthProvider.mockReset();
    setProviderApiKey.mockReset();
    state.failLogin = false;
    state.geminiRequiresProject = false;
    state.holdLogin = false;
    state.requireManualRedirect = false;
    state.providerKeys = [];
    state.settingsRows = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("starts browser OAuth login and stores the provider row", async () => {
    const { ProviderSettings } = await import("@/components/provider-settings");
    const { rerender } = render(React.createElement(ProviderSettings));

    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]);

    await waitFor(() => {
      expect(loginAndStoreOAuthProvider).toHaveBeenCalledWith(
        "anthropic",
        "http://localhost:3000/auth/callback",
        expect.objectContaining({
          onManualRedirect: expect.any(Function),
          proxyUrl: "https://proxy.example/proxy",
        }),
      );
      expect(toastSuccess).toHaveBeenCalledWith("Connected to Anthropic (Claude Pro/Max)");
    });

    rerender(React.createElement(ProviderSettings));
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
  });

  it("shows the manual redirect prompt for localhost OAuth callbacks", async () => {
    state.requireManualRedirect = true;
    const { ProviderSettings } = await import("@/components/provider-settings");
    render(React.createElement(ProviderSettings));

    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]);

    expect(await screen.findByText("Complete browser sign-in")).toBeTruthy();
    expect(screen.getByText("Paste the full redirect URL here.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("http://localhost/callback"), {
      target: {
        value: "http://localhost/callback?code=code-1&state=state-1",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Connected to Anthropic (Claude Pro/Max)");
    });
  });

  it("shows the Copilot device code while login is pending", async () => {
    state.holdLogin = true;
    const { ProviderSettings } = await import("@/components/provider-settings");
    render(React.createElement(ProviderSettings));

    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[1]);

    expect(await screen.findByText("Complete device sign-in")).toBeTruthy();
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
    expect(screen.getByText("https://github.com/login/device")).toBeTruthy();
  });

  it("only asks for a Google Cloud project ID after Gemini reports it is required", async () => {
    state.geminiRequiresProject = true;
    const { ProviderSettings } = await import("@/components/provider-settings");
    render(React.createElement(ProviderSettings));

    expect(screen.queryByPlaceholderText("Optional Google Cloud project ID")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[2]);

    expect(
      await screen.findByText("This Google account requires a Google Cloud project ID."),
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Optional Google Cloud project ID"), {
      target: {
        value: "project-1",
      },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[2]);

    await waitFor(() => {
      expect(loginAndStoreOAuthProvider).toHaveBeenLastCalledWith(
        "google-gemini-cli",
        "http://localhost:3000/auth/callback",
        {
          googleProjectId: "project-1",
          proxyUrl: "https://proxy.example/proxy",
        },
      );
    });
  });

  it("shows an inline error when browser OAuth fails", async () => {
    state.failLogin = true;
    const { ProviderSettings } = await import("@/components/provider-settings");
    render(React.createElement(ProviderSettings));

    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]);

    expect(await screen.findByText("OAuth failed")).toBeTruthy();
  });

  it("shows connected providers from stored oauth credentials", async () => {
    state.providerKeys = [
      {
        provider: "openai-codex",
        value: JSON.stringify({
          access: "access",
          accountId: "acct-1",
          expires: Date.now() + 60_000,
          providerId: "openai-codex",
          refresh: "refresh",
        }),
      },
    ];

    const { ProviderSettings } = await import("@/components/provider-settings");

    render(React.createElement(ProviderSettings));

    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });
});
