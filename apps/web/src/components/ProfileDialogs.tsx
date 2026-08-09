/**
 * Profile editing and management dialogs with proper focus management.
 *
 * Both dialogs:
 * - Move focus to the dialog on open, restore on close
 * - Trap focus with Tab/Shift-Tab cycle
 * - Close on Escape via native <dialog> cancel event
 * - Are labelled and described for screen readers
 */
import { useEffect, useRef, useState } from "react";
import type { Profile, ProfileListEntry } from "@vitana/shared";
import { ProfileAvatar } from "./ProfileAvatar.js";

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const PET_SPECIES = [
  { value: "dog", label: "Dog" },
  { value: "cat", label: "Cat" },
  { value: "bird", label: "Bird" },
  { value: "fish", label: "Fish" },
  { value: "rabbit", label: "Rabbit" },
  { value: "horse", label: "Horse" },
  { value: "reptile", label: "Reptile" },
  { value: "other", label: "Other" }
];

function trapFocus(event: React.KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;
  const els = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!els.length) return;
  const first = els[0];
  const last = els[els.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function ProfileEditDialog({
  busy,
  profile,
  profilePhotoRevision,
  presentation = "edit",
  onClose,
  onPhotoChange,
  onPhotoRemove,
  onSubmit
}: {
  busy: boolean;
  profile?: Profile;
  profilePhotoRevision?: string;
  presentation?: "edit" | "welcome";
  onClose: () => void;
  onPhotoChange: (file: File) => Promise<string | undefined>;
  onPhotoRemove: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstFocusRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [subjectKind, setSubjectKind] = useState<NonNullable<Profile["subjectKind"]>>(profile?.subjectKind ?? "adult");
  const [units, setUnits] = useState<Profile["units"]>(profile?.units ?? "metric");
  const [height, setHeight] = useState(
    profile?.heightCm === undefined
      ? ""
      : String(units === "imperial" ? centimetersToInches(profile.heightCm) : profile.heightCm)
  );
  const [photoFeedback, setPhotoFeedback] = useState<string>();
  const today = new Date().toISOString().slice(0, 10);
  const adultBirthDateMaximum = new Date();
  adultBirthDateMaximum.setFullYear(adultBirthDateMaximum.getFullYear() - 18);
  const heightBoundsCm = subjectKind === "pet"
    ? { min: 5, max: 250 }
    : subjectKind === "child"
      ? { min: 30, max: 220 }
      : { min: 50, max: 260 };
  const heightBounds = units === "imperial"
    ? { min: centimetersToInches(heightBoundsCm.min), max: centimetersToInches(heightBoundsCm.max) }
    : heightBoundsCm;
  const petSpecies = profile?.pet?.species ?? "";
  const hasCustomPetSpecies = petSpecies !== "" && !PET_SPECIES.some((species) => species.value === petSpecies);

  function changeUnits(nextUnits: Profile["units"]) {
    const numericHeight = Number(height);
    if (height !== "" && Number.isFinite(numericHeight)) {
      setHeight(String(nextUnits === "imperial" ? centimetersToInches(numericHeight) : inchesToCentimeters(numericHeight)));
    }
    setUnits(nextUnits);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    if (presentation === "welcome") headingRef.current?.focus();
    else firstFocusRef.current?.focus();
    const handleCancel = (e: Event) => { e.preventDefault(); onCloseRef.current(); };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={presentation === "welcome" ? "profile-dialog welcome-profile-dialog" : "profile-dialog"}
      aria-labelledby="profile-dialog-title"
      aria-describedby={presentation === "welcome" ? "profile-dialog-description" : undefined}
      onKeyDown={(e) => trapFocus(e, dialogRef.current)}
    >
      <div className="panel-heading-row">
        <div>
          <h2 id="profile-dialog-title" ref={headingRef} tabIndex={presentation === "welcome" ? -1 : undefined}>
            {presentation === "welcome" ? "Welcome to Vitana Health!" : "Edit profile"}
          </h2>
          {presentation === "welcome" ? (
            <p id="profile-dialog-description" className="welcome-profile-description">
              Tell Vitana about yourself to help us tailor your experience. Everything stays in this local Vitana installation.
            </p>
          ) : null}
        </div>
        {presentation === "edit" ? <button type="submit" form="profile-edit-form" disabled={busy}>Save and close</button> : null}
      </div>
      <div className="profile-photo-editor">
        <ProfileAvatar displayName={profile?.displayName ?? "Profile"} revision={profilePhotoRevision} />
        <div>
          <div className="profile-photo-actions">
            <button
              className="profile-photo-action"
              type="button"
              disabled={busy}
              onClick={() => photoInputRef.current?.click()}
            >
              {profilePhotoRevision ? "Replace photo" : "Choose photo"}
            </button>
            {profilePhotoRevision ? (
              <button className="profile-photo-action profile-photo-remove" type="button" disabled={busy} onClick={onPhotoRemove}>Remove photo</button>
            ) : null}
          </div>
          <input
            ref={photoInputRef}
            id="profile-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              setPhotoFeedback("Saving photo...");
              const error = await onPhotoChange(file);
              setPhotoFeedback(error ?? "Photo saved.");
            }}
          />
          {photoFeedback ? <p className="profile-photo-feedback" role="status">{photoFeedback}</p> : null}
        </div>
      </div>
      <form id="profile-edit-form" onSubmit={onSubmit} className="profile-form">
        <label htmlFor="profile-displayName">Name</label>
        <input
          id="profile-displayName"
          ref={firstFocusRef}
          name="displayName"
          defaultValue={profile?.displayName ?? "Local user"}
        />

        <label htmlFor="profile-subjectKind">Profile type</label>
        <select
          id="profile-subjectKind"
          name="subjectKind"
          value={subjectKind}
          onChange={(event) => setSubjectKind(event.target.value as NonNullable<Profile["subjectKind"]>)}
        >
          <option value="adult">Adult</option>
          <option value="child">Child</option>
          <option value="pet">Pet</option>
        </select>

        <label htmlFor="profile-birthDate">Birth date</label>
        <input
          id="profile-birthDate"
          name="birthDate"
          type="date"
          max={subjectKind === "adult" ? adultBirthDateMaximum.toISOString().slice(0, 10) : today}
          defaultValue={profile?.birthDate ?? ""}
        />

        <label htmlFor="profile-sex">Sex</label>
        <select id="profile-sex" name="sex" defaultValue={profile?.sex ?? "not-specified"}>
          <option value="not-specified">Prefer not to say</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="intersex">Intersex</option>
          <option value="unknown">Unknown</option>
        </select>

        {subjectKind === "pet" ? (
          <>
            <label htmlFor="profile-petSpecies">Pet species</label>
            <select id="profile-petSpecies" name="petSpecies" defaultValue={petSpecies} required>
              <option value="">Select species</option>
              {hasCustomPetSpecies ? <option value={petSpecies}>{petSpecies}</option> : null}
              {PET_SPECIES.map((species) => <option value={species.value} key={species.value}>{species.label}</option>)}
            </select>

            <label htmlFor="profile-petBreed">Pet breed</label>
            <input id="profile-petBreed" name="petBreed" defaultValue={profile?.pet?.breed ?? ""} />

            <label htmlFor="profile-petMicrochipId">Microchip ID</label>
            <input id="profile-petMicrochipId" name="petMicrochipId" defaultValue={profile?.pet?.microchipId ?? ""} />
          </>
        ) : null}

        {subjectKind !== "pet" ? (
          <>
            <label htmlFor="profile-height">Height {units === "imperial" ? "in" : "cm"}</label>
            <input
              id="profile-height"
              name="height"
              type="number"
              step="0.1"
              min={heightBounds.min}
              max={heightBounds.max}
              value={height}
              onChange={(event) => setHeight(event.target.value)}
            />
          </>
        ) : null}

        <label htmlFor="profile-units">Units</label>
        <select
          id="profile-units"
          name="units"
          value={units}
          onChange={(event) => changeUnits(event.target.value as Profile["units"])}
        >
          <option value="metric">Metric</option>
          <option value="imperial">Imperial</option>
        </select>

        {subjectKind !== "pet" ? (
          <>
            <label htmlFor="profile-bloodType">Blood type</label>
            <select id="profile-bloodType" name="bloodType" defaultValue={profile?.bloodType ?? "unknown"}>
              <option value="unknown">Unknown</option>
              <option value="a-positive">A+</option>
              <option value="a-negative">A-</option>
              <option value="b-positive">B+</option>
              <option value="ab-positive">AB+</option>
              <option value="ab-negative">AB-</option>
              <option value="o-positive">O+</option>
              <option value="o-negative">O-</option>
            </select>
          </>
        ) : null}

        <label htmlFor="profile-goalSummary" className="wide">Goals</label>
        <textarea
          id="profile-goalSummary"
          name="goalSummary"
          className="wide"
          defaultValue={profile?.goalSummary ?? ""}
        />

        <div className="profile-form-actions">
          <button type="submit" disabled={busy}>Save profile</button>
          <button type="button" className={presentation === "welcome" ? "welcome-profile-later" : undefined} disabled={busy} onClick={onClose}>
            {presentation === "welcome" ? "Set up later" : "Cancel"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function centimetersToInches(value: number): number {
  return Math.round((value / 2.54) * 10) / 10;
}

function inchesToCentimeters(value: number): number {
  return Math.round((value * 2.54) * 10) / 10;
}

export function ProfileManagerDialog({
  busy,
  profiles,
  activeProfile,
  activeProfileId,
  newProfileName,
  allowProfileCreation,
  onNewProfileNameChange,
  onClose,
  onSwitchProfile,
  onEditProfile,
  onCreateProfile,
  onDeleteActive
}: {
  busy: boolean;
  profiles: ProfileListEntry[];
  activeProfile?: ProfileListEntry | Profile;
  activeProfileId?: string;
  newProfileName: string;
  allowProfileCreation: boolean;
  onNewProfileNameChange: (value: string) => void;
  onClose: () => void;
  onSwitchProfile: (profileId: string) => void;
  onEditProfile: (profileId: string) => void;
  onCreateProfile: () => void;
  onDeleteActive: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusable[0]?.focus();
    const handleCancel = (e: Event) => { e.preventDefault(); onCloseRef.current(); };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="profile-dialog"
      aria-labelledby="profile-manager-title"
      onKeyDown={(e) => trapFocus(e, dialogRef.current)}
    >
      <div className="panel-heading-row">
        <div>
          <h2 id="profile-manager-title">Manage profiles</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close profile manager">Close</button>
      </div>

      <div className="profile-manager-list" role="list" aria-label="Profiles">
        {profiles.map((entry) => {
          const isActive = entry.id === activeProfileId;
          return (
            <div className={`profile-manager-row ${isActive ? "active" : ""}`} role="listitem" key={entry.id}>
              <ProfileAvatar
                compact
                displayName={entry.displayName}
                revision={isActive ? entry.profilePhoto?.revision : undefined}
              />
              <div>
                <strong>{entry.displayName}</strong>
                <span>{isActive ? "Active profile" : "Stored locally"}</span>
              </div>
              <div className="profile-manager-actions">
                {!isActive ? (
                  <button className="profile-manager-switch" type="button" disabled={busy} onClick={() => onSwitchProfile(entry.id)}>
                    Switch
                  </button>
                ) : null}
                <button className="profile-manager-edit" type="button" disabled={busy} onClick={() => onEditProfile(entry.id)}>
                  Edit
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <details className="profile-create-disclosure">
        <summary>Add profile</summary>
        {!allowProfileCreation ? <p className="profile-create-pro-note">Creating multiple profiles requires Vitana Pro.</p> : null}
        <form
          className="profile-create-row"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateProfile();
          }}
        >
          <label htmlFor="profile-new-name">Profile name</label>
          <input
            id="profile-new-name"
            disabled={!allowProfileCreation || busy}
            value={newProfileName}
            onChange={(event) => onNewProfileNameChange(event.target.value)}
            placeholder="New profile name"
            maxLength={80}
          />
          <button disabled={!allowProfileCreation || busy}>Create profile</button>
        </form>
      </details>

      <div className="profile-dialog-actions">
        <button
          type="button"
          disabled={busy || profiles.length <= 1}
          onClick={onDeleteActive}
          aria-label={`Delete active profile: ${activeProfile?.displayName ?? "current profile"}`}
        >
          Delete active profile
        </button>
      </div>
    </dialog>
  );
}
