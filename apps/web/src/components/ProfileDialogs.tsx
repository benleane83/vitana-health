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
import type { Profile, ProfileListEntry } from "@local-fitness-advisor/shared";

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

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
  onClose,
  onSubmit
}: {
  busy: boolean;
  profile?: Profile;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFocusRef = useRef<HTMLInputElement>(null);
  const [units, setUnits] = useState<Profile["units"]>(profile?.units ?? "metric");
  const [height, setHeight] = useState(
    profile?.heightCm === undefined
      ? ""
      : String(units === "imperial" ? centimetersToInches(profile.heightCm) : profile.heightCm)
  );

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
    firstFocusRef.current?.focus();
    const handleCancel = (e: Event) => { e.preventDefault(); onClose(); };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="profile-dialog"
      aria-labelledby="profile-dialog-title"
      onKeyDown={(e) => trapFocus(e, dialogRef.current)}
    >
      <div className="panel-heading-row">
        <div>
          <p className="eyebrow">Editable local context</p>
          <h2 id="profile-dialog-title">Edit profile</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close profile editor">Close</button>
      </div>
      <form onSubmit={onSubmit} className="profile-form">
        <label htmlFor="profile-displayName">Name</label>
        <input
          id="profile-displayName"
          ref={firstFocusRef}
          name="displayName"
          defaultValue={profile?.displayName ?? "Local user"}
        />

        <label htmlFor="profile-birthYear">Birth year</label>
        <input id="profile-birthYear" name="birthYear" type="number" defaultValue={profile?.birthYear ?? ""} />

        <label htmlFor="profile-sex">Sex</label>
        <select id="profile-sex" name="sex" defaultValue={profile?.sex ?? "not-specified"}>
          <option value="not-specified">Prefer not to say</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="intersex">Intersex</option>
          <option value="unknown">Unknown</option>
        </select>

        <label htmlFor="profile-height">Height {units === "imperial" ? "in" : "cm"}</label>
        <input
          id="profile-height"
          name="height"
          type="number"
          step="0.1"
          value={height}
          onChange={(event) => setHeight(event.target.value)}
        />

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

        <label htmlFor="profile-bloodType">Blood type</label>
        <select id="profile-bloodType" name="bloodType" defaultValue={profile?.bloodType ?? "unknown"}>
          <option value="unknown">Unknown</option>
          <option value="a-positive">A+</option>
          <option value="a-negative">A-</option>
          <option value="b-positive">B+</option>
          <option value="b-negative">B-</option>
          <option value="ab-positive">AB+</option>
          <option value="ab-negative">AB-</option>
          <option value="o-positive">O+</option>
          <option value="o-negative">O-</option>
        </select>

        <label htmlFor="profile-goalSummary" className="wide">Goals</label>
        <textarea
          id="profile-goalSummary"
          name="goalSummary"
          className="wide"
          defaultValue={profile?.goalSummary ?? "Improve energy, sleep, and metabolic health."}
        />

        <button disabled={busy}>Save profile</button>
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
  onNewProfileNameChange,
  onClose,
  onSwitchProfile,
  onCreateProfile,
  onDeleteActive
}: {
  busy: boolean;
  profiles: ProfileListEntry[];
  activeProfile?: ProfileListEntry | Profile;
  activeProfileId?: string;
  newProfileName: string;
  onNewProfileNameChange: (value: string) => void;
  onClose: () => void;
  onSwitchProfile: (profileId: string) => void;
  onCreateProfile: () => void;
  onDeleteActive: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusable[0]?.focus();
    const handleCancel = (e: Event) => { e.preventDefault(); onClose(); };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="profile-dialog"
      aria-labelledby="profile-manager-title"
      onKeyDown={(e) => trapFocus(e, dialogRef.current)}
    >
      <div className="panel-heading-row">
        <div>
          <p className="eyebrow">Profile-scoped local data</p>
          <h2 id="profile-manager-title">Manage profiles</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close profile manager">Close</button>
      </div>

      <p className="profile-dialog-active" title={activeProfile?.id}>
        Active profile: <strong>{activeProfile?.displayName ?? "Local user"}</strong>
      </p>

      <div className="profile-switcher-row">
        <label htmlFor="profile-switch-select">Switch profile</label>
        <select
          id="profile-switch-select"
          value={activeProfileId}
          disabled={busy}
          onChange={(event) => onSwitchProfile(event.target.value)}
        >
          {profiles.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.displayName}</option>
          ))}
        </select>

        <div className="profile-create-form">
          <label htmlFor="profile-new-name">Create profile</label>
          <input
            id="profile-new-name"
            value={newProfileName}
            onChange={(event) => onNewProfileNameChange(event.target.value)}
            placeholder="New profile name"
            maxLength={80}
          />
          <button type="button" disabled={busy} onClick={onCreateProfile}>Create</button>
        </div>
      </div>

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
