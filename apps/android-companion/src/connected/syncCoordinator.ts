import type { ReplicaHandshake, ReplicaIdentity } from "@vitana/shared";
import type { LocalReplicaMetadata, LocalStore } from "../standalone/localStore";
import type { ReplicaClient } from "./replicaClient";

export interface ReplicaSyncResult {
  identity: ReplicaIdentity;
  cachedAt?: string;
}

export class ReplicaSyncCoordinator {
  private active?: Promise<ReplicaSyncResult>;
  private disposed = false;

  constructor(
    private readonly client: ReplicaClient,
    private readonly store: LocalStore,
    private readonly expectedIdentity?: Partial<ReplicaIdentity>
  ) {}

  synchronize(): Promise<ReplicaSyncResult> {
    if (this.disposed) return Promise.reject(new Error("The connected sync coordinator is closed."));
    this.active ??= this.perform().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.active?.catch(() => undefined);
  }

  private async perform(): Promise<ReplicaSyncResult> {
    const handshake = await this.client.handshake();
    assertExpectedIdentity(handshake, this.expectedIdentity);
    const identity = replicaIdentity(handshake);
    let metadata = await this.store.replicaMetadata(identity);
    if (metadata && hasRewound(handshake, metadata)) {
      // The PC store was restored or rebuilt, so its sequence counter restarted below our cursor.
      // Nothing would ever match a delta request again, leaving the phone frozen on stale data.
      await this.store.deleteReplica(identity);
      metadata = undefined;
    }
    if (!metadata?.initialSnapshotCompleted) {
      // Resume an interrupted first snapshot rather than making the PC mint a fresh one.
      let cursor = metadata?.snapshotCursor;
      do {
        const page = await this.client.snapshot(cursor);
        assertPageIdentity(pageIdentity(page), identity);
        await this.store.applyReplicaPage(page);
        cursor = page.nextCursor;
      } while (cursor);
      metadata = await this.store.replicaMetadata(identity);
    }
    if (!metadata?.initialSnapshotCompleted) {
      throw new Error("The first connected snapshot did not complete.");
    }

    let cursor: string | undefined;
    do {
      const page = await this.client.deltas(metadata.cursorSequence, cursor);
      assertPageIdentity(pageIdentity(page), identity);
      await this.store.applyReplicaPage(page);
      cursor = page.nextCursor;
    } while (cursor);
    metadata = await this.store.replicaMetadata(identity);
    return { identity, cachedAt: metadata?.cachedAt };
  }
}

/**
 * True when the paired PC reports less history than we already hold. `serverInstanceId` only catches
 * a *different* PC; this catches the same PC whose replica log was reset underneath us.
 */
function hasRewound(handshake: ReplicaHandshake, metadata: LocalReplicaMetadata): boolean {
  return handshake.highWaterMark.sequence < metadata.cursorSequence ||
    handshake.highWaterMark.revision < metadata.revision;
}

function replicaIdentity(handshake: ReplicaHandshake): ReplicaIdentity {
  return {
    serverInstanceId: handshake.serverInstanceId,
    profileId: handshake.profileId,
    pairingId: handshake.pairingId
  };
}

function pageIdentity(page: ReplicaIdentity): ReplicaIdentity {
  return {
    serverInstanceId: page.serverInstanceId,
    profileId: page.profileId,
    pairingId: page.pairingId
  };
}

function assertExpectedIdentity(
  actual: ReplicaIdentity,
  expected: Partial<ReplicaIdentity> | undefined
): void {
  if (!expected) return;
  for (const key of ["serverInstanceId", "profileId", "pairingId"] as const) {
    if (expected[key] && expected[key] !== actual[key]) {
      throw new Error("The paired PC identity changed. Unpair and pair again before reusing connected data.");
    }
  }
}

function assertPageIdentity(actual: ReplicaIdentity, expected: ReplicaIdentity): void {
  if (
    actual.serverInstanceId !== expected.serverInstanceId ||
    actual.profileId !== expected.profileId ||
    actual.pairingId !== expected.pairingId
  ) {
    throw new Error("The replica page identity does not match the authenticated handshake.");
  }
}

