import { describe, expect, it, vi } from "vitest";
import { resolvePrincipalStore, type AuthorizationPrincipal } from "../requestPrincipal.js";
import type { ManagedProfileRepository } from "../storage/profileRepository.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

describe("resolvePrincipalStore", () => {
  it("uses the PC active store for owners", () => {
    const active = { profileId: "pc-active" } as ManagedProfileRepository;
    const manager = {
      getActiveStore: vi.fn(() => active),
      getStore: vi.fn()
    } as unknown as ProfileStoreManager;

    expect(resolvePrincipalStore(manager, { kind: "owner" })).toBe(active);
    expect(manager.getStore).not.toHaveBeenCalled();
  });

  it("uses only the single profile assigned to a companion", () => {
    const assigned = { profileId: "phone-profile" } as ManagedProfileRepository;
    const manager = {
      getActiveStore: vi.fn(),
      getStore: vi.fn(() => assigned)
    } as unknown as ProfileStoreManager;
    const principal: AuthorizationPrincipal = {
      kind: "companion",
      pairingId: "pairing",
      deviceId: "phone",
      capabilities: [],
      allowedProfileIds: ["phone-profile"]
    };

    expect(resolvePrincipalStore(manager, principal)).toBe(assigned);
    expect(manager.getStore).toHaveBeenCalledWith("phone-profile");
    expect(manager.getActiveStore).not.toHaveBeenCalled();
  });
});
