import type { MessageRow, ResolvedRepoSource } from "./types";

export type PublicShareMessageRow = Extract<
  MessageRow,
  { role: "assistant" | "toolResult" | "user" }
>;

export type PublicShareMessageRole = PublicShareMessageRow["role"];

export interface PublicSessionRecord {
  createdAt: string;
  id: string;
  ownerUserId: string;
  publishedAt: string;
  realmId: "rlm-public";
  repoSource?: ResolvedRepoSource;
  sourceUrl?: string;
  title: string;
  updatedAt: string;
}

export type PublicMessageRecord = PublicShareMessageRow & {
  realmId: "rlm-public";
};
