import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PairingStore } from "../pairing.js";
import { createApp } from "../createApp.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

const ownerToken = "test-owner-token-for-profile-photo";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

function fixture() {
  let photo: {
    contentType: "image/jpeg";
    bytes: Buffer;
    revision: string;
    updatedAt: string;
  } | undefined;
  const makeStore = (profileId: string) => ({
    profileId,
    getProfilePhoto: vi.fn(async () => photo),
    replaceProfilePhoto: vi.fn(async (contentType: "image/jpeg", bytes: Buffer) => {
      photo = {
        contentType,
        bytes,
        revision: createHash("sha256").update(bytes).digest("hex"),
        updatedAt: "2026-07-24T10:00:00.000Z"
      };
      return photo;
    }),
    deleteProfilePhoto: vi.fn(async () => {
      const existed = Boolean(photo);
      photo = undefined;
      return existed;
    })
  });
  const active = makeStore("active");
  const assigned = makeStore("assigned");
  const manager = {
    getActiveProfileId: () => "active",
    getActiveStore: () => active,
    getStore: (id: string) => id === "assigned" ? assigned : active,
    listProfiles: () => [
      { id: "active", displayName: "Active", updatedAt: "" },
      { id: "assigned", displayName: "Assigned", updatedAt: "" }
    ],
    syncProfilePhotoMetadata: vi.fn()
  } as unknown as ProfileStoreManager;
  const pairings = new PairingStore();
  const challenge = pairings.createChallenge();
  const pairing = pairings.request("device", "Phone", challenge.code)!;
  pairings.approve(pairing.record.id, "assigned");
  const token = pairings.getStatus(pairing.record.id, pairing.pollingSecret)!.token!;
  return { active, assigned, manager, pairings, token, pairingId: pairing.record.id };
}

describe("profile photo routes", () => {
  beforeEach(() => {
    process.env.VITANA_OWNER_TOKEN = ownerToken;
  });

  afterEach(() => {
    delete process.env.VITANA_OWNER_TOKEN;
  });

  it("validates, replaces, reads, and removes an owner photo without caching", async () => {
    const { active, manager, pairings } = fixture();
    const app = createApp(manager, pairings);
    const owner = { authorization: "Bearer " + ownerToken };

    expect((await request(app).get("/api/profile/photo").set(owner)).status).toBe(404);
    const replaced = await request(app).put("/api/profile/photo").set(owner).send({
      contentType: "image/jpeg",
      contentBase64: jpeg.toString("base64")
    });
    expect(replaced.status).toBe(200);
    expect(replaced.headers["cache-control"]).toBe("no-store");
    expect(replaced.body.revision).toBe(createHash("sha256").update(jpeg).digest("hex"));

    const fetched = await request(app).get("/api/profile/photo").set(owner);
    expect(fetched.status).toBe(200);
    expect(fetched.body.contentBase64).toBe(jpeg.toString("base64"));
    expect(fetched.headers["cache-control"]).toBe("no-store");

    expect((await request(app).delete("/api/profile/photo").set(owner)).body).toEqual({ deleted: true });
    expect(active.deleteProfilePhoto).toHaveBeenCalledOnce();
    expect((await request(app).delete("/api/profile/photo").set(owner)).status).toBe(404);
  });

  it.each([
    [{ contentType: "image/png", contentBase64: jpeg.toString("base64") }, "contentType"],
    [{ contentType: "image/jpeg", contentBase64: "not base64" }, "contentBase64"],
    [{ contentType: "image/jpeg", contentBase64: Buffer.from("not jpeg").toString("base64") }, "JPEG"],
    [{
      contentType: "image/jpeg",
      contentBase64: Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.alloc(256 * 1024),
        Buffer.from([0xff, 0xd9])
      ]).toString("base64")
    }, "exceed"]
  ])("rejects an invalid upload", async (body, message) => {
    const { manager, pairings } = fixture();
    const response = await request(createApp(manager, pairings))
      .put("/api/profile/photo")
      .set({ authorization: "Bearer " + ownerToken })
      .send(body);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain(message);
  });

  it("allows only the assigned companion to read and rejects companion mutations and revoked tokens", async () => {
    const { assigned, manager, pairings, token, pairingId } = fixture();
    assigned.getProfilePhoto.mockResolvedValue({
      contentType: "image/jpeg",
      bytes: jpeg,
      revision: createHash("sha256").update(jpeg).digest("hex"),
      updatedAt: "2026-07-24T10:00:00.000Z"
    });
    const app = createApp(manager, pairings);
    const companion = { "x-companion-token": token };

    expect((await request(app).get("/api/profile/photo").set(companion)).status).toBe(200);
    expect(assigned.getProfilePhoto).toHaveBeenCalledOnce();
    expect((await request(app).put("/api/profile/photo").set(companion).send({
      contentType: "image/jpeg",
      contentBase64: jpeg.toString("base64")
    })).status).toBe(403);
    expect((await request(app).delete("/api/profile/photo").set(companion)).status).toBe(403);

    pairings.revoke(pairingId);
    expect((await request(app).get("/api/profile/photo").set(companion)).status).toBe(401);
  });

  it("lets the owner read another profile photo without exposing it to companions", async () => {
    const { active, assigned, manager, pairings, token } = fixture();
    assigned.getProfilePhoto.mockResolvedValue({
      contentType: "image/jpeg",
      bytes: jpeg,
      revision: createHash("sha256").update(jpeg).digest("hex"),
      updatedAt: "2026-07-24T10:00:00.000Z"
    });
    const app = createApp(manager, pairings);

    const fetched = await request(app)
      .get("/api/profiles/assigned/photo")
      .set({ authorization: "Bearer " + ownerToken });

    expect(fetched.status).toBe(200);
    expect(fetched.headers["cache-control"]).toBe("no-store");
    expect(fetched.body.contentBase64).toBe(jpeg.toString("base64"));
    expect(assigned.getProfilePhoto).toHaveBeenCalledOnce();
    expect(active.getProfilePhoto).not.toHaveBeenCalled();

    expect((await request(app)
      .get("/api/profiles/active/photo")
      .set({ "x-companion-token": token })).status).toBe(403);
  });
});
