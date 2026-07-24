import { useEffect, useState } from "react";
import type { AnalyticsSummary, AppBootstrap, Profile, ProfileListEntry } from "@vitana/shared";
import { api } from "../../api.js";
import { ProfileEditDialog, ProfileManagerDialog } from "../../components/ProfileDialogs.js";
import { numberOrUndefined } from "../../utils.js";
import { normalizeProfilePhoto } from "../../profilePhoto.js";

type ProfileSnapshot = {
  bootstrap?: AppBootstrap;
  analytics?: AnalyticsSummary;
  profiles: ProfileListEntry[];
  activeProfileId?: string;
};

type ProfileUiState = {
  editorOpen: boolean;
  managerOpen: boolean;
  newProfileName: string;
  busy: boolean;
};

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

  useEffect(() => {
    let cancelled = false;
    void loadSnapshot().then((nextSnapshot) => {
      if (!cancelled) setSnapshot(nextSnapshot);
    }).catch((error: unknown) => {
      if (!cancelled) onNotice(error instanceof Error ? error.message : "Unable to load local health data.");
    });
    return () => { cancelled = true; };
  }, []);

  async function refresh() {
    setSnapshot(await loadSnapshot());
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
    const form = new FormData(event.currentTarget);
    const units = String(form.get("units") || "metric") as Profile["units"];
    const height = numberOrUndefined(form.get("height"));
    await run("Profile saved locally.", async () => {
      await api.saveProfile({
        displayName: String(form.get("displayName") || "Local user"),
        subjectKind: String(form.get("subjectKind") || "adult") as NonNullable<Profile["subjectKind"]>,
        birthDate: String(form.get("birthDate") || "") || undefined,
        sex: String(form.get("sex") || "not-specified") as Profile["sex"],
        heightCm: height === undefined ? undefined : units === "imperial" ? height * 2.54 : height,
        bloodType: String(form.get("bloodType") || "unknown") as Profile["bloodType"],
        goalSummary: String(form.get("goalSummary") || ""),
        pet: String(form.get("subjectKind")) === "pet" ? {
          species: String(form.get("petSpecies") || ""),
          breed: String(form.get("petBreed") || "") || undefined,
          microchipId: String(form.get("petMicrochipId") || "") || undefined
        } : undefined,
        units
      });
      await refresh();
      setUi((current) => ({ ...current, editorOpen: false }));
    });
  }

  async function switchProfile(profileId: string) {
    if (profileId === snapshot.activeProfileId) {
      setUi((current) => ({ ...current, managerOpen: false }));
      return;
    }
    await run("Profile switched.", async () => {
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

  async function replaceProfilePhoto(file: File) {
    await run("Profile photo updated.", async () => {
      const contentBase64 = await normalizeProfilePhoto(file);
      await api.profilePhoto.replace({ contentType: "image/jpeg", contentBase64 });
      await refresh();
    });
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
    removeProfilePhoto
  };
}

export type ProfileLifecycle = ReturnType<typeof useProfileLifecycle>;

export function ProfileLifecycleDialogs({ lifecycle }: { lifecycle: ProfileLifecycle }) {
  return (
    <>
      {lifecycle.ui.editorOpen ? (
        <ProfileEditDialog
          busy={lifecycle.ui.busy}
          profile={lifecycle.profile}
          profilePhotoRevision={lifecycle.bootstrap?.profilePhoto?.revision}
          onClose={lifecycle.closeEditor}
          onPhotoChange={(file) => { void lifecycle.replaceProfilePhoto(file); }}
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
          onNewProfileNameChange={lifecycle.setNewProfileName}
          onClose={lifecycle.closeManager}
          onSwitchProfile={(profileId) => { void lifecycle.switchProfile(profileId); }}
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

async function loadSnapshot(): Promise<ProfileSnapshot> {
  const [bootstrap, analytics, profileList] = await Promise.all([
    api.bootstrap(),
    api.analytics(),
    api.profiles.list()
  ]);
  return {
    bootstrap,
    analytics,
    profiles: profileList.profiles,
    activeProfileId: profileList.activeProfileId
  };
}