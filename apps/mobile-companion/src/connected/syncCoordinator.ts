import type { ReplicaHandshake, ReplicaIdentity } from "@vitana/shared";
import type { LocalReplicaMetadata, LocalStore } from "../standalone/localStore";
import type { ReplicaClient } from "./replicaClient";

export interface ReplicaSyncResult {
  identity: ReplicaIdentity;
  cachedAt?: string;
}

/**
 * Hard ceiling on pages per sync leg. A PC-side cursor bug that keeps returning the same
 * `nextCursor` would otherwise spin forever, writing to SQLite and draining the battery. Well above
 * any real dataset: at the server's page size this covers millions of rows.
 */
const MAX_REPLICA_PAGES = 10_000;

/**
 * Appended to the pairing id to key the replacement replica built during a rewind rebuild. The PC
 * never issues a pairing id containing this, so it cannot collide with a real one.
 */
const STAGING_PAIRING_SUFFIX = "#staging";

export class ReplicaSyncCoordinator {
  private active?: Promise<ReplicaSyncResult>;
  private disposed = false;

  constructor(
    private readonly client: ReplicaClient,
    private readonly store: LocalStore,
    private readonly expectedIdentity?: Partial<ReplicaIdentity>,
    /** Overridden only by tests, so they can prove the ceiling holds without grinding through it. */
    private readonly maxPages: number = MAX_REPLICA_PAGES
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
    // The PC store was restored or rebuilt, so its sequence counter restarted below our cursor.
    // Nothing would ever match a delta request again, leaving the phone frozen on stale data. The
    // replacement is built under a staging identity so the copy the user already has keeps serving
    // reads until the new one is complete - deleting first left them staring at an empty app for
    // the length of a full re-download, and at nothing at all if it failed part way.
    const stagingIdentity = metadata && hasRewound(handshake, metadata)
      ? { ...identity, pairingId: `${identity.pairingId}${STAGING_PAIRING_SUFFIX}` }
      : undefined;
    const writeIdentity = stagingIdentity ?? identity;
    if (stagingIdentity) {
      // Discard any half-built staging replica left by an earlier interrupted rebuild.
      await this.store.deleteReplica(stagingIdentity);
      metadata = undefined;
    }
    if (!metadata?.initialSnapshotCompleted) {
      // Resume an interrupted first snapshot rather than making the PC mint a fresh one.
      let cursor = metadata?.snapshotCursor;
      let pages = 0;
      do {
        this.assertNotDisposed();
        assertPageBudget(pages, this.maxPages, "snapshot");
        const page = await this.client.snapshot(cursor);
        assertPageIdentity(pageIdentity(page), identity);
        await this.store.applyReplicaPage({ ...page, ...writeIdentity });
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor);
      metadata = await this.store.replicaMetadata(writeIdentity);
    }
    if (!metadata?.initialSnapshotCompleted) {
      throw new Error("The first connected snapshot did not complete.");
    }

    let cursor: string | undefined;
    let pages = 0;
    do {
      this.assertNotDisposed();
      assertPageBudget(pages, this.maxPages, "delta");
      const page = await this.client.deltas(metadata.cursorSequence, cursor);
      assertPageIdentity(pageIdentity(page), identity);
      await this.store.applyReplicaPage({ ...page, ...writeIdentity });
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    if (stagingIdentity) await this.store.promoteReplica(stagingIdentity, identity);
    metadata = await this.store.replicaMetadata(identity);
    return { identity, cachedAt: metadata?.cachedAt };
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error("The connected sync coordinator is closed.");
  }
}

function assertPageBudget(pages: number, maxPages: number, leg: "snapshot" | "delta"): void {
  if (pages >= maxPages) {
    throw new Error(`Connected ${leg} sync exceeded ${maxPages} pages; the paired PC is not advancing its cursor.`);
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

