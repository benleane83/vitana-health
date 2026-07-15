import express from "express";
import { z } from "zod";
import type { ProfileStoreManager } from "../store.js";
import type { Profile } from "@local-fitness-advisor/shared";

const profileSchema = z.object({
  displayName: z.string().min(1).max(80),
  subjectKind: z.enum(["adult", "child", "pet"]).default("adult"),
  birthDate: z.string().date().optional(),
  sex: z.enum(["female", "male", "intersex", "unknown", "not-specified"]).optional(),
  heightCm: z.number().positive().max(260).optional(),
  bloodType: z.enum(["a-positive", "a-negative", "b-positive", "b-negative", "ab-positive", "ab-negative", "o-positive", "o-negative", "unknown"]).optional(),
  goalSummary: z.string().max(500).optional(),
  pet: z.object({
    species: z.string().trim().min(1).max(80), breed: z.string().trim().max(80).optional(),
    reproductiveStatus: z.enum(["intact", "neutered", "spayed", "unknown"]).optional(),
    microchipId: z.string().trim().max(100).optional()
  }).optional(),
  units: z.enum(["metric", "imperial"])
}).superRefine((profile, context) => {
  if (profile.subjectKind === "pet" && !profile.pet?.species) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pet", "species"], message: "Pet profiles require a species." });
  }
});

const cloudConsentSchema = z.object({
  enabled: z.boolean(),
  providerScopeAccepted: z.boolean(),
  consentVersion: z.string().min(1).max(40).optional()
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

  router.get("/", async (_request, response, next) => {
    try {
      response.json(await storeManager.getActiveStore().getProfile());
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (request, response, next) => {
    try {
      const parsed = profileSchema.parse(request.body);
      const store = storeManager.getActiveStore();
      const existing = await store.getProfile();
      const profile: Profile = {
        ...existing,
        ...parsed,
        id: store.profileId,
        updatedAt: new Date().toISOString()
      };
      const saved = await store.replaceProfile(profile);
      storeManager.syncProfileEntry(saved);
      response.json(saved);
    } catch (error) {
      next(error);
    }
  });

  router.get("/cloud-ai-consent", async (_request, response, next) => {
    try {
      const profile = await storeManager.getActiveStore().getProfile();
      response.json(
        profile.cloudAiConsent ?? {
          enabled: false,
          providerScopeAccepted: false,
          consentedAt: undefined,
          consentVersion: undefined
        }
      );
    } catch (error) {
      next(error);
    }
  });

  router.put("/cloud-ai-consent", async (request, response, next) => {
    try {
      const parsed = cloudConsentSchema.parse(request.body ?? {});
      const store = storeManager.getActiveStore();
      const current = await store.getProfile();
      const nextConsent = parsed.enabled
        ? {
            enabled: true,
            providerScopeAccepted: parsed.providerScopeAccepted,
            consentedAt: new Date().toISOString(),
            consentVersion: parsed.consentVersion ?? "v1"
          }
        : {
            enabled: false,
            providerScopeAccepted: false,
            consentedAt: undefined,
            consentVersion: parsed.consentVersion ?? current.cloudAiConsent?.consentVersion ?? "v1"
          };

      const saved = await store.replaceProfile({
        ...current,
        cloudAiConsent: nextConsent,
        id: store.profileId,
        updatedAt: new Date().toISOString()
      });
      storeManager.syncProfileEntry(saved);
      response.json(saved.cloudAiConsent);
    } catch (error) {
      next(error);
    }
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

  router.post("/", async (request, response, next) => {
    try {
      const parsed = createProfileSchema.parse(request.body ?? {});
      const created = await storeManager.createProfile(parsed.displayName);
      response.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.get("/active", (_request, response) => {
    response.json({ profileId: storeManager.getActiveProfileId() });
  });

  router.put("/active", (request, response) => {
    const parsed = setActiveProfileSchema.parse(request.body ?? {});
    const profileId = storeManager.setActiveProfile(parsed.profileId);
    response.json({ profileId });
  });

  router.delete("/:id", async (request, response, next) => {
    try {
      const profileId = profileIdSchema.parse(request.params.id);
      const result = await storeManager.deleteProfile(profileId);
      response.json({
        deletedProfileId: profileId,
        activeProfileId: result.activeProfileId,
        profiles: storeManager.listProfiles()
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
