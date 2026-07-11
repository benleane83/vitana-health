import express from "express";
import { z } from "zod";
import type { ProfileStoreManager } from "../store.js";
import type { Profile } from "@local-fitness-advisor/shared";

const profileSchema = z.object({
  displayName: z.string().min(1).max(80),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  sex: z.enum(["female", "male", "intersex", "unknown", "not-specified"]).optional(),
  heightCm: z.number().positive().max(260).optional(),
  goalSummary: z.string().max(500).optional(),
  units: z.enum(["metric", "imperial"])
});

const profileIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Profile id contains unsupported characters.");

const createProfileSchema = z.object({
  displayName: z.string().min(1).max(80)
});

const setActiveProfileSchema = z.object({
  profileId: profileIdSchema
});

export function makeProfileRoutes(storeManager: ProfileStoreManager): express.Router {
  const router = express.Router();

  router.get("/", (_request, response) => {
    response.json(storeManager.getActiveStore().snapshot().profile);
  });

  router.put("/", (request, response) => {
    const parsed = profileSchema.parse(request.body);
    const store = storeManager.getActiveStore();
    const profile: Profile = {
      ...parsed,
      id: store.profileId,
      updatedAt: new Date().toISOString()
    };
    const saved = store.replaceProfile(profile);
    storeManager.syncProfileEntry(saved);
    response.json(saved);
  });

  return router;
}

export function makeProfilesRoutes(storeManager: ProfileStoreManager): express.Router {
  const router = express.Router();

  router.get("/", (_request, response) => {
    response.json({
      profiles: storeManager.listProfiles(),
      activeProfileId: storeManager.getActiveProfileId()
    });
  });

  router.post("/", (request, response) => {
    const parsed = createProfileSchema.parse(request.body ?? {});
    const created = storeManager.createProfile(parsed.displayName);
    response.status(201).json(created);
  });

  router.get("/active", (_request, response) => {
    response.json({ profileId: storeManager.getActiveProfileId() });
  });

  router.put("/active", (request, response) => {
    const parsed = setActiveProfileSchema.parse(request.body ?? {});
    const profileId = storeManager.setActiveProfile(parsed.profileId);
    response.json({ profileId });
  });

  router.delete("/:id", (request, response) => {
    const profileId = profileIdSchema.parse(request.params.id);
    const result = storeManager.deleteProfile(profileId);
    response.json({
      deletedProfileId: profileId,
      activeProfileId: result.activeProfileId,
      profiles: storeManager.listProfiles()
    });
  });

  return router;
}
