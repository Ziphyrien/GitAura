import { env } from "@gitinspect/env/server";
import { Autumn } from "autumn-js";
import {
  AUTUMN_CUSTOMER_EXPAND_FIELDS,
  hasPaidAutumnCustomer,
  type AutumnEntitlementCustomer,
} from "@/lib/subscription-entitlements";

const autumn = env.AUTUMN_SECRET_KEY
  ? new Autumn({
      secretKey: env.AUTUMN_SECRET_KEY,
    })
  : null;

export type AppSessionUser = {
  email?: string | null;
  ghId?: string | null;
  id: string;
  name?: string | null;
};

export function getCanonicalAppUserId(user: AppSessionUser): string {
  return user.ghId ?? user.id;
}

async function loadAutumnCustomer(user: AppSessionUser): Promise<AutumnEntitlementCustomer | null> {
  if (!autumn) {
    return null;
  }

  return (await autumn.customers.getOrCreate({
    customerId: getCanonicalAppUserId(user),
    email: user.email ?? undefined,
    expand: [...AUTUMN_CUSTOMER_EXPAND_FIELDS],
    name: user.name ?? undefined,
  })) as AutumnEntitlementCustomer;
}

export async function isSyncEntitledForUser(user: AppSessionUser): Promise<boolean> {
  return hasPaidAutumnCustomer(await loadAutumnCustomer(user));
}

export async function isShareEntitledForUser(user: AppSessionUser): Promise<boolean> {
  return hasPaidAutumnCustomer(await loadAutumnCustomer(user));
}
