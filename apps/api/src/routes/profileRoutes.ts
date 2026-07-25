import express from "express";
import { z } from "zod";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { profilePhotoUploadSchema, type MeasurementRegistryResetResponse, type Profile } from "@vitana/shared";
import type { PairingStore } from "../pairing.js";
import type { AuthorizationPrincipal } from "../createApp.js";
import { resolvePrincipalStore } from "../requestPrincipal.js";

const maximumProfilePhotoBytes = 256 * 1024;

const profileSchema = z.object({
  displayName: z.string().min(1).max(80),
  subjectKind: z.enum(["adult", "child", "pet"]).default("adult"),
  birthDate: z.string().date().optional(),
  sex: z.enum(["female", "male", "intersex", "unknown", "not-specified"]).optional(),
  heightCm: z.number().positive().optional(),
  bloodType: z.enum(["a-positive", "a-negative", "b-positive", "b-negative", "ab-positive", "ab-negative", "o-positive", "o-negative", "unknown"]).optional(),
  goalSummary: z.string().max(500).optional(),
  pet: z.object({
    species: z.string().trim().min(1).max(80), breed: z.string().trim().max(80).optional(),
    reproductiveStatus: z.enum(["intact", "neutered", "spayed", "unknown"]).optional(),
    microchipId: z.string().trim().max(100).optional()
  }).optional(),
  units: z.enum(["metric", "imperial"])
}).superRefine((profile, context) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (profile.birthDate) {
    const birthDate = new Date(`${profile.birthDate}T00:00:00.000Z`);
    const adultCutoff = new Date(today);
    adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18);
    if (birthDate > today) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["birthDate"], message: "Birth date cannot be in the future." });
    } else if (profile.subjectKind === "adult" && birthDate > adultCutoff) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["birthDate"], message: "Adult profiles must be at least 18 years old." });
    } else if (profile.subjectKind === "child" && birthDate <= adultCutoff) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["birthDate"], message: "Child profiles must be under 18 years old." });
    }
  }
  if (profile.heightCm !== undefined) {
    const bounds = profile.subjectKind === "pet"
      ? { min: 5, max: 250 }
      : profile.subjectKind === "child"
        ? { min: 30, max: 220 }
        : { min: 50, max: 260 };
    if (profile.heightCm < bounds.min || profile.heightCm > bounds.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heightCm"],
        message: `Height for ${profile.subjectKind} profiles must be between ${bounds.min} and ${bounds.max} cm.`
      });
    }
  }
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

  router.get("/photo", async (_request, response, next) => {
    try {
      response.setHeader("cache-control", "no-store");
      const store = resolvePrincipalStore(
        storeManager,
        response.locals.principal as AuthorizationPrincipal
      );
      const photo = await store.getProfilePhoto();
      if (!photo) {
        response.status(404).json({ error: "Profile photo not found.", code: "PROFILE_PHOTO_NOT_FOUND" });
        return;
      }
      response.json({
        contentType: photo.contentType,
        contentBase64: photo.bytes.toString("base64"),
        revision: photo.revision,
        updatedAt: photo.updatedAt
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/photo", async (request, response, next) => {
    try {
      requireOwner(response);
      response.setHeader("cache-control", "no-store");
      const payload = profilePhotoUploadSchema.parse(request.body ?? {});
      const bytes = decodeProfilePhoto(payload.contentBase64);
      const store = storeManager.getActiveStore();
      const photo = await store.replaceProfilePhoto(payload.contentType, bytes);
      storeManager.syncProfilePhotoMetadata(store.profileId, photo);
      response.json({
        contentType: photo.contentType,
        contentBase64: photo.bytes.toString("base64"),
        revision: photo.revision,
        updatedAt: photo.updatedAt
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/photo", async (_request, response, next) => {
    try {
      requireOwner(response);
      response.setHeader("cache-control", "no-store");
      const store = storeManager.getActiveStore();
      if (!await store.deleteProfilePhoto()) {
        response.status(404).json({ error: "Profile photo not found.", code: "PROFILE_PHOTO_NOT_FOUND" });
        return;
      }
      storeManager.syncProfilePhotoMetadata(store.profileId);
      response.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

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

  router.post("/measurement-types/reset", async (_request, response, next) => {
    try {
      const store = storeManager.getActiveStore();
      const result: MeasurementRegistryResetResponse = {
        profileId: store.profileId,
        ...await store.resetMeasurementTypeMetadataFromRegistry()
      };
      response.json(result);
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

function requireOwner(response: express.Response): void {
  const principal = response.locals.principal as AuthorizationPrincipal;
  if (principal.kind !== "owner") {
    throw Object.assign(new Error("Only the profile owner can change profile photos."), { status: 403 });
  }
}

function decodeProfilePhoto(contentBase64: string): Buffer {
  if (
    contentBase64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)
  ) {
    throw photoValidationError("Profile photo must be canonical base64.");
  }
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length === 0 || bytes.length > maximumProfilePhotoBytes) {
    throw photoValidationError(`Profile photo must not exceed ${maximumProfilePhotoBytes} decoded bytes.`);
  }
  if (
    bytes.length < 5 ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
    bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9
  ) {
    throw photoValidationError("Profile photo must contain JPEG data.");
  }
  return bytes;
}

function photoValidationError(message: string): z.ZodError {
  return new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["contentBase64"], message }]);
}

export function makeProfilesRoutes(storeManager: ProfileStoreManager, pairingStore: PairingStore): express.Router {
  const router = express.Router();

  router.get("/", (_request, response) => {
    const principal = response.locals.principal as AuthorizationPrincipal;
    if (principal.kind === "companion") {
      const profile = storeManager.listProfiles().find((entry) => entry.id === principal.allowedProfileIds[0]);
      response.json({ profiles: profile ? [{ id: profile.id, displayName: profile.displayName }] : [] });
      return;
    }
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
      pairingStore.revokeProfile(profileId);
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
