import * as React from "react";
import { isDbCloudConfigured, isDbCloudSyncConfigured } from "@gitinspect/db";
import { env } from "@gitinspect/env/web";
import { bootstrapDexieCloud, markSyncReloadPending } from "@/lib/bootstrap-dexie-cloud";

function SyncBootstrapLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center px-6 text-sm text-muted-foreground">
      Preparing workspace...
    </div>
  );
}

export function SyncBootstrapGate(props: { children: React.ReactNode; syncEnabled: boolean }) {
  const [ready, setReady] = React.useState(false);
  const reloadRequestedRef = React.useRef(false);
  const shouldUseSyncMode = props.syncEnabled && Boolean(env.VITE_DEXIE_CLOUD_DB_URL);

  React.useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (reloadRequestedRef.current) {
        if (!cancelled) {
          setReady(false);
        }
        return;
      }

      if (isDbCloudConfigured() && shouldUseSyncMode !== isDbCloudSyncConfigured()) {
        reloadRequestedRef.current = true;
        markSyncReloadPending();
        window.location.reload();
        return;
      }

      if (!cancelled) {
        setReady(false);
      }

      try {
        await bootstrapDexieCloud(props.syncEnabled);
      } catch (error) {
        console.error("Could not prepare workspace", error);
      }

      if (!cancelled) {
        setReady(true);
      }
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, [props.syncEnabled, shouldUseSyncMode]);

  if (!ready) {
    return <SyncBootstrapLoading />;
  }

  return <>{props.children}</>;
}
