import { useEffect, useRef, useState } from "react";
import type { AnalyticsSummary, AppBootstrap, EntitlementResponse, Profile, ProfileListEntry } from "@vitana/shared";
import { api } from "../../api.js";
import { ProfileEditDialog, ProfileManagerDialog } from "../../components/ProfileDialogs.js";
import { numberOrUndefined } from "../../utils.js";
import { normalizeProfilePhoto } from "../../profilePhoto.js";

type ProfileSnapshot = {
  bootstrap?: AppBootstrap;
  analytics?: AnalyticsSummary;
  profiles: ProfileListEntry[];
  activeProfileId?: string;
  entitlement?: EntitlementResponse;
};

type ProfileUiState = {
  editorOpen: boolean;
  managerOpen: boolean;
  newProfileName: string;
  busy: boolean;
};

type EditableProfile = Omit<Profile, "id" | "updatedAt" | "setupStatus">;

type ConfirmAction = (
  title: string,
  description: string,
  confirmLabel: string,
  destructive: boolean
) => Promise<boolean>;

export function useProfileLifecycle(onNotice: (message: string) => void, confirm: ConfirmAction) {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot>({ profiles: [] });
  const [ui, setUi] = useState<ProfileUiState>({
    editorOpen: false,
    managerOpen: false,
    newProfileName: "",
    busy: false
  });
  // `refresh` runs after every profile mutation, including switching. Without a generation token
  // a slow response for the profile the user just left can resolve last and render one family
  // member's health data under another's name. The token also aborts the superseded requests so
  // they stop competing for the connection.
  const load = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });

  useEffect(() => {
    void refresh();
    return () => { load.current.controller?.abort(); };
  }, []);

  /**
   * @param options.profiles Whether the profile roster is re-read. Recording an observation cannot
   * change it, so data mutations skip that request rather than fanning out to every endpoint.
   */
  async function refresh(options: { profiles?: boolean } = {}) {
    const includeProfiles = options.profiles ?? true;
    const generation = ++load.current.generation;
    load.current.controller?.abort();
    const controller = new AbortController();
    load.current.controller = controller;
    try {
      const next = await loadSnapshot(controller.signal, includeProfiles);
      if (generation === load.current.generation) {
        setSnapshot((current) => ({ ...current, ...next }));
      }
    } catch (error: unknown) {
      if (generation !== load.current.generation || controller.signal.aborted) return;
      onNotice(error instanceof Error ? error.message : "Unable to load local health data.");
    }
  }

  async function run(success: string, task: () => Promise<void>): Promise<boolean> {
    setUi((current) => ({ ...current, busy: true }));
    try {
      await task();
      onNotice(success);
      return true;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
      return false;
    } finally {
      setUi((current) => ({ ...current, busy: false }));
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("Profile saved locally.", async () => {
      await api.saveProfile(profileInput(new FormData(event.currentTarget)));
      await refresh();
      setUi((current) => ({ ...current, editorOpen: false }));
    });
  }

  async function completeInitialSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("Profile set up locally.", async () => {
      await api.profileSetup.complete(profileInput(new FormData(event.currentTarget)));
      await refresh();
    });
  }

  async function dismissInitialSetup() {
    await run("You can finish setting up your profile from Edit Profile.", async () => {
      await api.profileSetup.dismiss();
      await refresh();
    });
  }

  async function switchProfile(profileId: string) {
    if (profileId === snapshot.activeProfileId) {
      setUi((current) => ({ ...current, managerOpen: false }));
      return false;
    }
    return run("Profile switched.", async () => {
      await api.profiles.setActive(profileId);
      await refresh();
      setUi((current) => ({ ...current, managerOpen: false }));
    });
  }

  async function editProfile(profileId: string) {
    if (profileId !== snapshot.activeProfileId) {
      const switched = await run("Profile switched.", async () => {
        await api.profiles.setActive(profileId);
        await refresh();
      });
      if (!switched) return;
    }
    setUi((current) => ({ ...current, managerOpen: false, editorOpen: true }));
  }

  async function createProfile() {
    const displayName = ui.newProfileName.trim();
    if (!displayName) {
      onNotice("Enter a profile name first.");
      return;
    }
    await run("Profile created.", async () => {
      const created = await api.profiles.create(displayName);
      await api.profiles.setActive(created.id);
      await refresh();
      setUi((current) => ({ ...current, newProfileName: "" }));
    });
  }

  async function deleteProfile(profileId: string) {
    const target = snapshot.profiles.find((entry) => entry.id === profileId);
    const approved = await confirm(
      "Delete profile",
      `Delete profile "${target?.displayName ?? profileId}"? This removes its local encrypted store.`,
      "Delete",
      true
    );
    if (!approved) return;
    await run("Profile deleted.", async () => {
      await api.profiles.remove(profileId);
      await refresh();
    });
  }

  async function replaceProfilePhoto(file: File): Promise<string | undefined> {
    setUi((current) => ({ ...current, busy: true }));
    try {
      const contentBase64 = await normalizeProfilePhoto(file);
      await api.profilePhoto.replace({ contentType: "image/jpeg", contentBase64 });
      await refresh();
      onNotice("Profile photo updated.");
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected local error.";
      onNotice(message);
      return message;
    } finally {
      setUi((current) => ({ ...current, busy: false }));
    }
  }

  async function removeProfilePhoto() {
    const approved = await confirm(
      "Remove profile photo",
      "Remove this profile photo? Initials will be shown instead.",
      "Remove",
      true
    );
    if (!approved) return;
    await run("Profile photo removed.", async () => {
      await api.profilePhoto.remove();
      await refresh();
    });
  }

  const profile = snapshot.bootstrap?.profile;
  const activeProfile = snapshot.profiles.find((entry) => entry.id === snapshot.activeProfileId) ?? profile;

  return {
    ...snapshot,
    profile,
    activeProfile,
    ui,
    refresh,
    openEditor: () => setUi((current) => ({ ...current, editorOpen: true })),
    openManager: () => setUi((current) => ({ ...current, managerOpen: true })),
    closeEditor: () => setUi((current) => ({ ...current, editorOpen: false })),
    closeManager: () => setUi((current) => ({ ...current, managerOpen: false })),
    setNewProfileName: (newProfileName: string) => setUi((current) => ({ ...current, newProfileName })),
    saveProfile,
    switchProfile,
    editProfile,
    createProfile,
    deleteProfile,
    replaceProfilePhoto,
    removeProfilePhoto,
    completeInitialSetup,
    dismissInitialSetup
  };
}

export type ProfileLifecycle = ReturnType<typeof useProfileLifecycle>;

export function ProfileLifecycleDialogs({
  lifecycle,
  allowProfileCreation,
  onManagerProfileSwitched
}: {
  lifecycle: ProfileLifecycle;
  allowProfileCreation: boolean;
  onManagerProfileSwitched?: () => void;
}) {
  return (
    <>
      {lifecycle.profile?.setupStatus === "pending" ? (
        <ProfileEditDialog
          busy={lifecycle.ui.busy}
          profile={lifecycle.profile}
          profilePhotoRevision={lifecycle.bootstrap?.profilePhoto?.revision}
          presentation="welcome"
          onClose={() => { void lifecycle.dismissInitialSetup(); }}
          onPhotoChange={lifecycle.replaceProfilePhoto}
          onPhotoRemove={() => { void lifecycle.removeProfilePhoto(); }}
          onSubmit={lifecycle.completeInitialSetup}
        />
      ) : lifecycle.ui.editorOpen ? (
        <ProfileEditDialog
          busy={lifecycle.ui.busy}
          profile={lifecycle.profile}
          profilePhotoRevision={lifecycle.bootstrap?.profilePhoto?.revision}
          onClose={lifecycle.closeEditor}
          onPhotoChange={lifecycle.replaceProfilePhoto}
          onPhotoRemove={() => { void lifecycle.removeProfilePhoto(); }}
          onSubmit={lifecycle.saveProfile}
        />
      ) : null}
      {lifecycle.ui.managerOpen ? (
        <ProfileManagerDialog
          busy={lifecycle.ui.busy}
          profiles={lifecycle.profiles}
          activeProfile={lifecycle.activeProfile}
          activeProfileId={lifecycle.activeProfileId}
          newProfileName={lifecycle.ui.newProfileName}
          allowProfileCreation={allowProfileCreation}
          onNewProfileNameChange={lifecycle.setNewProfileName}
          onClose={lifecycle.closeManager}
          onSwitchProfile={async (profileId) => {
            if (await lifecycle.switchProfile(profileId)) onManagerProfileSwitched?.();
          }}
          onEditProfile={(profileId) => { void lifecycle.editProfile(profileId); }}
          onCreateProfile={() => { void lifecycle.createProfile(); }}
          onDeleteActive={() => {
            if (lifecycle.activeProfileId) void lifecycle.deleteProfile(lifecycle.activeProfileId);
          }}
        />
      ) : null}
    </>
  );
}

async function loadSnapshot(signal: AbortSignal | undefined, includeProfiles: boolean): Promise<Partial<ProfileSnapshot>> {
  const [bootstrap, analytics, profileList, entitlement] = await Promise.all([
    api.bootstrap(signal),
    api.analytics(signal),
    includeProfiles ? api.profiles.list(signal) : undefined,
    api.entitlement.get(signal).catch(() => ({ tier: "free", source: null, overridden: false } as const))
  ]);
  return {
    bootstrap,
    analytics,
    entitlement,
    ...(profileList ? { profiles: profileList.profiles, activeProfileId: profileList.activeProfileId } : {})
  };
}

function profileInput(form: FormData): EditableProfile {
  const units = String(form.get("units") || "metric") as Profile["units"];
  const height = numberOrUndefined(form.get("height"));
  const subjectKind = String(form.get("subjectKind") || "adult") as NonNullable<Profile["subjectKind"]>;
  return {
    displayName: String(form.get("displayName") || "Local user"),
    subjectKind,
    birthDate: String(form.get("birthDate") || "") || undefined,
    sex: String(form.get("sex") || "not-specified") as Profile["sex"],
    heightCm: height === undefined ? undefined : units === "imperial" ? height * 2.54 : height,
    bloodType: String(form.get("bloodType") || "unknown") as Profile["bloodType"],
    goalSummary: String(form.get("goalSummary") || ""),
    pet: subjectKind === "pet" ? {
      species: String(form.get("petSpecies") || ""),
      breed: String(form.get("petBreed") || "") || undefined,
      microchipId: String(form.get("petMicrochipId") || "") || undefined
    } : undefined,
    units
  };
}