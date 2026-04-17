export const AUTUMN_CUSTOMER_EXPAND_FIELDS = ["subscriptions.plan", "purchases.plan"] as const;

export type AutumnEntitlementPlan = {
  name?: string | null;
};

export type AutumnEntitlementPurchase = {
  expiresAt: number | null;
  plan?: AutumnEntitlementPlan | null;
  planId: string;
};

export type AutumnEntitlementSubscription = {
  addOn?: boolean;
  autoEnable?: boolean;
  canceledAt?: number | null;
  currentPeriodEnd?: number | null;
  pastDue?: boolean;
  plan?: AutumnEntitlementPlan | null;
  planId: string;
  status: string;
};

export type AutumnEntitlementCustomer = {
  id?: string | null;
  purchases?: AutumnEntitlementPurchase[];
  subscriptions?: AutumnEntitlementSubscription[];
};

function isPaidSubscription(autoEnable: boolean | undefined): boolean {
  return autoEnable !== true;
}

export function hasPaidAutumnCustomer(
  customer: AutumnEntitlementCustomer | null | undefined,
): boolean {
  if (!customer) {
    return false;
  }

  const activeSubscription =
    customer.subscriptions?.find(
      (subscription) =>
        !subscription.addOn &&
        (subscription.status === "active" || subscription.status === "scheduled"),
    ) ?? customer.subscriptions?.find((subscription) => !subscription.addOn);

  if (activeSubscription) {
    return isPaidSubscription(activeSubscription.autoEnable);
  }

  const now = Date.now();
  return (
    customer.purchases?.some(
      (purchase) => purchase.expiresAt === null || purchase.expiresAt > now,
    ) ?? false
  );
}
