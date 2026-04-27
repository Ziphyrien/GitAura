import { getProviders as getRegistryProviders } from "@mariozechner/pi-ai";
import { isOAuthProviderId, type OAuthProviderId } from "@gitaura/pi/auth/oauth-types";
import type {
  KnownProvider,
  ProviderGroupDefinition,
  ProviderGroupId,
  ProviderId,
} from "@gitaura/pi/types/models";

const OPENAI_GPT_5_4_SELECTOR_MODEL_IDS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"] as const;
const UNORDERED = 10_000;

export interface ProviderConfig {
  apiKeySettings?: {
    hidden?: boolean;
    order?: number;
  };
  defaultModel?: string;
  description?: string;
  label?: string;
  modelSelector?: {
    modelIds?: readonly string[];
    order?: number;
  };
  oauth?: {
    label: string;
    order?: number;
  };
}

export const PROVIDER_CONFIGS: Partial<Record<KnownProvider, ProviderConfig>> = {
  "amazon-bedrock": {
    apiKeySettings: { hidden: true },
  },
  anthropic: {
    apiKeySettings: { order: 10 },
    defaultModel: "claude-sonnet-4-6",
    description: "Claude API and Claude subscription OAuth",
    label: "Anthropic",
    modelSelector: { order: 10 },
    oauth: {
      label: "Anthropic (Claude Pro/Max)",
      order: 10,
    },
  },
  "azure-openai-responses": {
    apiKeySettings: { hidden: true },
  },
  "github-copilot": {
    apiKeySettings: { hidden: true },
    defaultModel: "gpt-4o",
    description: "GitHub Copilot subscription and API-compatible access",
    label: "Copilot",
    modelSelector: { order: 20 },
    oauth: {
      label: "GitHub Copilot",
      order: 30,
    },
  },
  google: {
    apiKeySettings: { order: 50 },
  },
  "google-antigravity": {
    apiKeySettings: { hidden: true },
  },
  "google-gemini-cli": {
    apiKeySettings: { hidden: true },
    defaultModel: "gemini-2.5-pro",
    description: "Cloud Code Assist OAuth for Gemini models",
    label: "Gemini",
    modelSelector: { order: 30 },
    oauth: {
      label: "Google Gemini",
      order: 40,
    },
  },
  "google-vertex": {
    apiKeySettings: { hidden: true },
  },
  groq: {
    apiKeySettings: { order: 60 },
  },
  "kimi-coding": {
    apiKeySettings: { hidden: true },
  },
  mistral: {
    apiKeySettings: { order: 70 },
  },
  openai: {
    apiKeySettings: { order: 20 },
    defaultModel: "gpt-5.4",
    description: "OpenAI API key for GPT and o-series models",
    label: "OpenAI",
    modelSelector: {
      modelIds: OPENAI_GPT_5_4_SELECTOR_MODEL_IDS,
      order: 40,
    },
  },
  "openai-codex": {
    apiKeySettings: { hidden: true },
    defaultModel: "gpt-5.4",
    description: "ChatGPT subscription OAuth and Codex-compatible responses",
    label: "OpenAI Codex",
    modelSelector: {
      modelIds: OPENAI_GPT_5_4_SELECTOR_MODEL_IDS,
      order: 50,
    },
    oauth: {
      label: "ChatGPT Plus/Pro",
      order: 20,
    },
  },
  opencode: {
    apiKeySettings: { order: 30 },
    defaultModel: "gpt-5.1-codex-mini",
    description: "OpenCode API key for the full OpenCode catalog",
    label: "OpenCode",
    modelSelector: { order: 60 },
  },
  "opencode-go": {
    apiKeySettings: { order: 40 },
    defaultModel: "glm-5",
    description: "OpenCode Go API key for the Go-line catalog",
    label: "OpenCode Go",
    modelSelector: { order: 70 },
  },
};

function getRegistryKnownProviders(): KnownProvider[] {
  return getRegistryProviders() as KnownProvider[];
}

function getProviderConfig(provider: ProviderId): ProviderConfig | undefined {
  return PROVIDER_CONFIGS[provider as KnownProvider];
}

function prettyProviderLabel(provider: string): string {
  return provider
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compareByOrderThenLabel<T extends ProviderId>(
  left: T,
  right: T,
  getOrder: (provider: T) => number | undefined,
): number {
  const orderDelta = (getOrder(left) ?? UNORDERED) - (getOrder(right) ?? UNORDERED);
  if (orderDelta !== 0) {
    return orderDelta;
  }

  const labelA = getProviderGroupMetadata(left as ProviderGroupId).label;
  const labelB = getProviderGroupMetadata(right as ProviderGroupId).label;
  return labelA.localeCompare(labelB, undefined, { sensitivity: "base" });
}

export function getProviderGroupMetadata(providerGroup: ProviderGroupId): ProviderGroupDefinition {
  const config = getProviderConfig(providerGroup);

  return {
    canonicalProvider: providerGroup as ProviderId,
    description: config?.description ?? "",
    id: providerGroup,
    label: config?.label ?? prettyProviderLabel(providerGroup),
  };
}

export function getCanonicalProvider(providerGroup: ProviderGroupId): ProviderId {
  return getProviderGroupMetadata(providerGroup).canonicalProvider;
}

export function getDefaultProviderGroup(provider: ProviderId): ProviderGroupId {
  return provider as ProviderGroupId;
}

export function getDefaultModelId(provider: ProviderId): string | undefined {
  return getProviderConfig(provider)?.defaultModel;
}

export function getConfiguredDefaultModels(): Partial<Record<ProviderId, string>> {
  const entries = (Object.entries(PROVIDER_CONFIGS) as Array<[ProviderId, ProviderConfig]>)
    .filter(([, config]) => typeof config.defaultModel === "string")
    .map(([provider, config]) => [provider, config.defaultModel as string] as const);

  return Object.fromEntries(entries) as Partial<Record<ProviderId, string>>;
}

export function getProviderSelectorModelIds(provider: ProviderId): readonly string[] | undefined {
  return getProviderConfig(provider)?.modelSelector?.modelIds;
}

export function getOAuthProviderIds(): OAuthProviderId[] {
  return getRegistryKnownProviders()
    .filter((provider): provider is OAuthProviderId => {
      return isOAuthProviderId(provider) && getProviderConfig(provider)?.oauth !== undefined;
    })
    .sort((left, right) =>
      compareByOrderThenLabel(left, right, (provider) => getProviderConfig(provider)?.oauth?.order),
    );
}

export function getOAuthProvidersForSettings(): OAuthProviderId[] {
  return getOAuthProviderIds();
}

export function getOAuthProviderLabel(provider: OAuthProviderId): string {
  return getProviderConfig(provider)?.oauth?.label ?? getProviderGroupMetadata(provider).label;
}

export function getApiKeyProvidersForSettings(): KnownProvider[] {
  return getRegistryKnownProviders().filter(
    (provider) => getProviderConfig(provider)?.apiKeySettings?.hidden !== true,
  );
}

export function getRuntimeSupportedProviders(): ProviderId[] {
  const apiKeys = getApiKeyProvidersForSettings();
  const merged = new Set<ProviderId>([...apiKeys, ...getOAuthProviderIds()]);
  return [...merged].sort((left, right) => left.localeCompare(right));
}

export function getAtlasProviderGroups(): ProviderGroupId[] {
  const supported = getRuntimeSupportedProviders() as ProviderGroupId[];
  return supported.sort((left, right) =>
    compareByOrderThenLabel(
      left,
      right,
      (provider) => getProviderConfig(provider)?.modelSelector?.order,
    ),
  );
}

export function isProviderGroupId(value: string): value is ProviderGroupId {
  return (getRegistryProviders() as string[]).includes(value);
}

export function getSortedApiKeyProvidersForSettings(): KnownProvider[] {
  return getApiKeyProvidersForSettings().sort((left, right) =>
    compareByOrderThenLabel(
      left,
      right,
      (provider) => getProviderConfig(provider)?.apiKeySettings?.order,
    ),
  );
}
