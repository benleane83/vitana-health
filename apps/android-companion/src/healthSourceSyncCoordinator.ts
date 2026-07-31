import type { AppStateStatus } from "react-native";
import type { HealthConnectSyncProgress, SyncResult } from "./syncHealthConnect";

export function shouldCancelHealthSourceSync(
  appState: AppStateStatus,
  stage: HealthConnectSyncProgress["stage"] | undefined
): boolean {
  return appState !== "active" && stage !== "permissions";
}

/**
 * Module-scope guard for health source syncing. A component-local `if (syncing) return` only
 * protects one mounted screen, so a remount, a second tab, or a background trigger could start a
 * concurrent read of the same window. One coordinator per process removes that class of bug and
 * gives the UI a single place to cancel from.
 */
class HealthSourceSyncCoordinator {
  private active?: Promise<SyncResult>;
  private controller?: AbortController;

  get busy(): boolean {
    return this.active !== undefined;
  }

  /** Joins the in-flight sync when one exists rather than starting a second read. */
  run(perform: (signal: AbortSignal) => Promise<SyncResult>): Promise<SyncResult> {
    if (this.active) return this.active;
    const controller = new AbortController();
    this.controller = controller;
    this.active = perform(controller.signal).finally(() => {
      this.active = undefined;
      this.controller = undefined;
    });
    return this.active;
  }

  cancel(): void {
    this.controller?.abort();
  }
}

export const healthSourceSyncCoordinator = new HealthSourceSyncCoordinator();
