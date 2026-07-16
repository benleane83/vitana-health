import type { CompanionPrincipal } from "./pairing.js";
import type { ManagedProfileRepository } from "./storage/profileRepository.js";
import type { ProfileStoreManager } from "./storage/profileStoreManager.js";

export interface OwnerPrincipal {
  kind: "owner";
}

export type AuthorizationPrincipal = OwnerPrincipal | CompanionPrincipal;

export function resolvePrincipalStore(
  storeManager: ProfileStoreManager,
  principal: AuthorizationPrincipal
): ManagedProfileRepository {
  return principal.kind === "owner"
    ? storeManager.getActiveStore()
    : storeManager.getStore(principal.allowedProfileIds[0]);
}
