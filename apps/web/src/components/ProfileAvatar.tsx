import { useEffect, useState } from "react";
import { api, ApiError } from "../api.js";

export function profileInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return `${words[0][0]}${words.length > 1 ? words.at(-1)![0] : ""}`.toUpperCase();
}

export function ProfileAvatar({
  displayName,
  revision,
  compact = false
}: {
  displayName: string;
  revision?: string;
  compact?: boolean;
}) {
  const [source, setSource] = useState<string>();

  useEffect(() => {
    let current = true;
    setSource(undefined);
    if (!revision) return () => { current = false; };
    void api.profilePhoto.get().then((photo) => {
      if (current && photo.revision === revision) {
        setSource(`data:${photo.contentType};base64,${photo.contentBase64}`);
      }
    }).catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 404)) {
        // The initials fallback remains visible for transient and rendering failures.
      }
    });
    return () => { current = false; };
  }, [revision]);

  return (
    <span className={`profile-avatar ${compact ? "compact" : ""}`} aria-hidden="true">
      {source ? <img src={source} alt="" onError={() => setSource(undefined)} /> : profileInitials(displayName)}
    </span>
  );
}
