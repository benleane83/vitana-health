import { Router } from "express";
import { z } from "zod";
import {
  COMPANION_REPLICA_PAGE_SIZE,
  COMPANION_REPLICA_PROTOCOL_VERSION,
  type ReplicaPage
} from "@vitana/shared";
import type { PairingStore } from "../pairing.js";
import type { AuthorizationPrincipal } from "../requestPrincipal.js";
import { resolvePrincipalStore } from "../requestPrincipal.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { ReplicaDeltaGapError } from "../storage/duckdbRetention.js";

const pageQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  afterSequence: z.coerce.number().int().nonnegative().optional(),
  pageSize: z.coerce.number().int().min(1).max(COMPANION_REPLICA_PAGE_SIZE).default(COMPANION_REPLICA_PAGE_SIZE)
}).strict();

type SnapshotCursor = {
  kind: "snapshot";
  snapshotId: string;
  offset: number;
};

type DeltaCursor = {
  kind: "delta";
  afterSequence: number;
  highWaterSequence?: number;
};

export function makeCompanionSyncRoutes(
  storeManager: ProfileStoreManager,
  pairingStore: PairingStore
): Router {
  const router = Router();

  router.get("/handshake", async (_request, response, next) => {
    try {
      const principal = requireCompanion(response.locals.principal as AuthorizationPrincipal);
      const store = resolvePrincipalStore(storeManager, principal);
      response.setHeader("cache-control", "no-store");
      response.json({
        ...identity(pairingStore, principal),
        protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
        highWaterMark: await store.getReplicaHighWaterMark()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/snapshot", async (request, response, next) => {
    try {
      const principal = requireCompanion(response.locals.principal as AuthorizationPrincipal);
      const input = pageQuerySchema.parse(request.query);
      const store = resolvePrincipalStore(storeManager, principal);
      const cursor = input.cursor ? decodeCursor<SnapshotCursor>(input.cursor, "snapshot") : undefined;
      const snapshotId = cursor?.snapshotId ?? await store.startReplicaSnapshot(principal.pairingId);
      const page = await store.replicaSnapshotPage(
        principal.pairingId,
        snapshotId,
        cursor?.offset ?? 0,
        input.pageSize
      );
      if (!page) throw requestError(409, "The snapshot cursor is expired or belongs to another pairing.");
      response.setHeader("cache-control", "no-store");
      response.json(toPage(
        pairingStore,
        principal,
        "snapshot",
        page,
        page.nextOffset === undefined
          ? undefined
          : encodeCursor({ kind: "snapshot", snapshotId, offset: page.nextOffset })
      ));
    } catch (error) {
      next(error);
    }
  });

  router.get("/deltas", async (request, response, next) => {
    try {
      const principal = requireCompanion(response.locals.principal as AuthorizationPrincipal);
      const input = pageQuerySchema.parse(request.query);
      const store = resolvePrincipalStore(storeManager, principal);
      const cursor = input.cursor ? decodeCursor<DeltaCursor>(input.cursor, "delta") : {
        kind: "delta" as const,
        afterSequence: input.afterSequence ?? 0
      };
      const page = await store.replicaDeltaPage(
        cursor.afterSequence,
        cursor.highWaterSequence,
        input.pageSize
      );
      response.setHeader("cache-control", "no-store");
      response.json(toPage(
        pairingStore,
        principal,
        "delta",
        page,
        page.nextOffset === undefined
          ? undefined
          : encodeCursor({
              kind: "delta",
              afterSequence: page.nextOffset,
              highWaterSequence: page.highWaterMark.sequence
            })
      ));
    } catch (error) {
      next(error instanceof ReplicaDeltaGapError
        ? requestError(409, "The change log no longer covers this cursor. Restart from a snapshot.")
        : error);
    }
  });

  return router;
}

function identity(pairingStore: PairingStore, principal: ReturnType<typeof requireCompanion>) {
  return {
    serverInstanceId: pairingStore.getServerInstanceId(),
    profileId: principal.allowedProfileIds[0],
    pairingId: principal.pairingId
  };
}

function toPage(
  pairingStore: PairingStore,
  principal: ReturnType<typeof requireCompanion>,
  kind: ReplicaPage["kind"],
  page: Awaited<ReturnType<ReturnType<typeof resolvePrincipalStore>["replicaDeltaPage"]>>,
  nextCursor: string | undefined
): ReplicaPage {
  return {
    ...identity(pairingStore, principal),
    protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
    kind,
    changes: page.changes,
    highWaterMark: page.highWaterMark,
    ...(nextCursor ? { nextCursor } : {}),
    complete: nextCursor === undefined,
    cachedAt: new Date().toISOString()
  };
}

function requireCompanion(principal: AuthorizationPrincipal) {
  if (principal.kind !== "companion") throw requestError(403, "Replica sync requires a paired companion.");
  return principal;
}

function encodeCursor(value: SnapshotCursor | DeltaCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor<T extends SnapshotCursor | DeltaCursor>(value: string, kind: T["kind"]): T {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (decoded.kind !== kind) throw new Error("kind");
    if (kind === "snapshot") {
      if (typeof decoded.snapshotId !== "string" || !Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 0) {
        throw new Error("snapshot");
      }
    } else if (
      !Number.isSafeInteger(decoded.afterSequence) ||
      Number(decoded.afterSequence) < 0 ||
      (decoded.highWaterSequence !== undefined &&
        (!Number.isSafeInteger(decoded.highWaterSequence) || Number(decoded.highWaterSequence) < Number(decoded.afterSequence)))
    ) {
      throw new Error("delta");
    }
    return decoded as T;
  } catch {
    throw requestError(400, "The replica cursor is invalid.");
  }
}

function requestError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}
