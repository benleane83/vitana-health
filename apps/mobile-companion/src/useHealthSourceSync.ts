import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { healthConnectSyncWindowForTier, type HealthSourceSyncProgress } from "@vitana/shared";
import { useEntitlement } from "./EntitlementProvider";
import { updateHealthSourceCursors, updateHealthSourceSessionKey } from "./endpointStore";
import { healthSourceSyncCoordinator, shouldCancelHealthSourceSync } from "./healthSourceSyncCoordinator";
import { activeHealthSourceProvider } from "./healthSourceProvider";
import { useMobileApi } from "./MobileApiProvider";
import { userFacingError } from "./userFacingError";

export function useHealthSourceSync() {
  const { bootstrap, connection, refreshAfterImport, reloadConnection } = useMobileApi();
  const entitlement = useEntitlement();
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "danger">("success");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const syncStage = useRef<HealthSourceSyncProgress["stage"] | undefined>(undefined);
  useKeepAwake(syncing ? "health-source-sync" : undefined);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (shouldCancelHealthSourceSync(state, syncStage.current)) healthSourceSyncCoordinator.cancel();
    });
    return () => subscription.remove();
  }, []);

  function reportStatus(tone: "success" | "danger", message: string) {
    setStatusTone(tone);
    setStatus(message);
  }

  async function sync() {
    if (!connection || syncing || healthSourceSyncCoordinator.busy) return;
    const provider = activeHealthSourceProvider();
    if (!provider) {
      setStatusTone("danger");
      setStatus("This device has no supported health data source.");
      return;
    }
    setSyncing(true);
    setStatus("");
    syncStage.current = undefined;
    setSyncProgress(`Checking ${provider.label} on this phone…`);
    try {
      const result = await healthSourceSyncCoordinator.run((signal) => provider.sync(
        connection.url,
        connection.token,
        bootstrap?.profile.id ?? null,
        connection.publicKeyHash,
        {
          deviceId: connection.deviceId,
          syncCursors: connection.healthSourceCursors,
          sessionKey: connection.healthSourceSessionKey,
          syncWindowDays: healthConnectSyncWindowForTier(entitlement.state.tier, connection.healthConnectSyncWindowDays),
          categories: connection.healthSourceCategories,
          onProgress: ({ detail, stage }) => {
            syncStage.current = stage;
            setSyncProgress(detail);
          },
          onSessionKey: (sessionKey) => updateHealthSourceSessionKey(connection.url, sessionKey),
          signal
        }
      ));
      await updateHealthSourceCursors(connection.url, result.syncCursors);
      setStatusTone("success");
      setStatus(`${result.status} ${result.details}`);
      setSyncProgress("Refreshing your imported readings…");
      await reloadConnection({ preserveSession: true });
      await refreshAfterImport();
    } catch (caught) {
      setStatusTone("danger");
      setStatus(userFacingError(caught, "Sync failed. Check the connection to your paired PC and try again."));
    } finally {
      syncStage.current = undefined;
      setSyncing(false);
      setSyncProgress("");
    }
  }

  return { reportStatus, status, statusTone, sync, syncing, syncProgress };
}