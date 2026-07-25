import type { ReplicaHandshake, ReplicaIdentity } from "@vitana/shared";
import type { LocalStore } from "../standalone/localStore";
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

  dispose(): void {
    this.disposed = true;
  }

  private async perform(): Promise<ReplicaSyncResult> {
    const handshake = await this.client.handshake();
    assertExpectedIdentity(handshake, this.expectedIdentity);
    const identity = replicaIdentity(handshake);
    let metadata = await this.store.replicaMetadata(identity);
    if (!metadata?.initialSnapshotCompleted) {
      let cursor: string | undefined;
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

