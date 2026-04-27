/** Single source for provider groups, UI labels, and API-key visibility. */
import { getProviders as getRegistryProviders } from "@mariozechner/pi-ai";
import type {
  KnownProvider,
  ProviderGroupDefinition,
  ProviderGroupId,
  ProviderId,
} from "@gitaura/pi/types/models";

/** Same denylist as Sitegeist for API-key rows (OAuth-only or not for browser API keys). */
export const SITEGEIST_HIDDEN_API_KEY_PROVIDERS = new Set<KnownProvider>([
  "amazon-bedrock",
  "azure-openai-responses",
  "github-copilot",
  "google-antigravity",
  "google-vertex",
  "openai-codex",
  "google-gemini-cli",
  "kimi-coding",
]);

/** Subscription OAuth providers (explicit order). */
export const SUBSCRIPTION_OAUTH_PROVIDER_ORDER: KnownProvider[] = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
];

/** OAuth-only: no API-key row. */
export const OAUTH_ONLY_PROVIDERS = new Set<KnownProvider>([
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
]);

/** API-key settings rows: full pi-ai registry minus hidden providers. */
export function getApiKeyProvidersForSettings(): KnownProvider[] {
  const fromRegistry = getRegistryProviders() as KnownProvider[];
  return fromRegistry.filter((provider) => !SITEGEIST_HIDDEN_API_KEY_PROVIDERS.has(provider));
}

/** Providers that participate in model selection and runtime. */
export function getRuntimeSupportedProviders(): ProviderId[] {
  const apiKeys = getApiKeyProvidersForSettings();
  const merged = new Set<ProviderId>([...apiKeys, ...SUBSCRIPTION_OAUTH_PROVIDER_ORDER]);
  return [...merged].sort((a, b) => a.localeCompare(b));
}

/** Curated labels for common groups; others get a synthetic definition at runtime. */
export const PROVIDER_GROUPS: Partial<Record<ProviderGroupId, ProviderGroupDefinition>> = {
  anthropic: {
    canonicalProvider: "anthropic",
    description: "Claude API and Claude subscription OAuth",
    id: "anthropic",
    label: "Anthropic",
  },
  "github-copilot": {
    canonicalProvider: "github-copilot",
    description: "GitHub Copilot subscription and API-compatible access",
    id: "github-copilot",
    label: "Copilot",
  },
  "google-gemini-cli": {
    canonicalProvider: "google-gemini-cli",
    description: "Cloud Code Assist OAuth for Gemini models",
    id: "google-gemini-cli",
    label: "Gemini",
  },
  openai: {
    canonicalProvider: "openai",
    description: "OpenAI API key for GPT and o-series models",
    id: "openai",
    label: "OpenAI",
  },
  opencode: {
    canonicalProvider: "opencode",
    description: "OpenCode API key for the full OpenCode catalog",
    id: "opencode",
    label: "OpenCode",
  },
  "opencode-go": {
    canonicalProvider: "opencode-go",
    description: "OpenCode Go API key for the Go-line catalog",
    id: "opencode-go",
    label: "OpenCode Go",
  },
  "openai-codex": {
    canonicalProvider: "openai-codex",
    description: "ChatGPT subscription OAuth and Codex-compatible responses",
    id: "openai-codex",
    label: "OpenAI Codex",
  },
};

/** Preferred model-selector group order; remaining supported providers append sorted. */
const PROVIDER_GROUP_BASE_ORDER: readonly ProviderGroupId[] = [
  "anthropic",
  "github-copilot",
  "google-gemini-cli",
  "openai",
  "openai-codex",
  "opencode",
  "opencode-go",
] as const;

function prettyProviderLabel(provider: string): string {
  return provider
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getAtlasProviderGroups(): ProviderGroupId[] {
  const supported = new Set(getRuntimeSupportedProviders());
  const ordered: ProviderGroupId[] = [];

  for (const id of PROVIDER_GROUP_BASE_ORDER) {
    if (supported.has(id)) {
      ordered.push(id);
    }
  }

  const orderedSet = new Set<string>(ordered);
  const rest = [...supported]
    .filter((id) => !orderedSet.has(id))
    .sort((a, b) => a.localeCompare(b));
  ordered.push(...(rest as ProviderGroupId[]));

  return ordered;
}

export function isProviderGroupId(value: string): value is ProviderGroupId {
  return (getRegistryProviders() as string[]).includes(value);
}

export function getProviderGroupMetadata(providerGroup: ProviderGroupId): ProviderGroupDefinition {
  const known = PROVIDER_GROUPS[providerGroup];
  if (known) {
    return known;
  }

  return {
    canonicalProvider: providerGroup as ProviderId,
    description: "",
    id: providerGroup,
    label: prettyProviderLabel(providerGroup),
  };
}

export function getCanonicalProvider(providerGroup: ProviderGroupId): ProviderId {
  return getProviderGroupMetadata(providerGroup).canonicalProvider;
}

export function getDefaultProviderGroup(provider: ProviderId): ProviderGroupId {
  const meta = PROVIDER_GROUPS[provider as ProviderGroupId];
  if (meta) {
    return meta.id;
  }
  return provider as ProviderGroupId;
}

/**
 * Common providers first, then the rest A-Z by display label.
 */
const API_KEY_SETTINGS_PINNED_ORDER: KnownProvider[] = [
  "anthropic",
  "openai",
  "opencode",
  "opencode-go",
  "google",
  "groq",
  "mistral",
];

/**
 * API key rows for settings: OAuth-only providers removed, pinned providers first,
 * remaining providers sorted alphabetically by label.
 */
export function getSortedApiKeyProvidersForSettings(): KnownProvider[] {
  const list = getApiKeyProvidersForSettings().filter(
    (provider) => !OAUTH_ONLY_PROVIDERS.has(provider),
  );
  const pinnedSet = new Set(API_KEY_SETTINGS_PINNED_ORDER);
  const pinned = API_KEY_SETTINGS_PINNED_ORDER.filter((id) => list.includes(id));
  const rest = list
    .filter((id) => !pinnedSet.has(id))
    .sort((a, b) => {
      const labelA = getProviderGroupMetadata(a as ProviderGroupId).label;
      const labelB = getProviderGroupMetadata(b as ProviderGroupId).label;
      return labelA.localeCompare(labelB, undefined, { sensitivity: "base" });
    });
  return [...pinned, ...rest];
}
