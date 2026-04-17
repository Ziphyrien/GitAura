import type { DexieCloudOptions } from "dexie-cloud-addon";

export const fetchDexieCloudTokens: NonNullable<DexieCloudOptions["fetchTokens"]> = async (
  tokenParams,
) => {
  const response = await fetch("/api/dexie-cloud-token", {
    body: JSON.stringify(tokenParams),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Dexie Cloud token (${response.status})`);
  }

  return (await response.json()) as Awaited<
    ReturnType<NonNullable<DexieCloudOptions["fetchTokens"]>>
  >;
};
