import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/middleware/auth";
import { isSyncEntitledForUser } from "@/lib/autumn.server";

export type AppBootstrap = {
  isSignedIn: boolean;
  isSubscribed: boolean;
};

export function getSignedOutAppBootstrap(): AppBootstrap {
  return {
    isSignedIn: false,
    isSubscribed: false,
  };
}

export const getAppBootstrap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const user = context.session?.user;

    if (!user) {
      return getSignedOutAppBootstrap();
    }

    const isSubscribed = await isSyncEntitledForUser(user);

    return {
      isSignedIn: true,
      isSubscribed,
    } satisfies AppBootstrap;
  });
