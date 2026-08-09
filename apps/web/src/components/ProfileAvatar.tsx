import { useEffect, useState } from "react";
import { api, ApiError } from "../api.js";

const photoSourceCache = new Map<string, Promise<string | undefined>>();

export function profileInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return `${words[0][0]}${words.length > 1 ? words.at(-1)![0] : ""}`.toUpperCase();
}

export function ProfileAvatar({
  displayName,
  profileId,
  revision,
  compact = false
}: {
  displayName: string;
  profileId?: string;
  revision?: string;
  compact?: boolean;
}) {
  const [source, setSource] = useState<string>();

  useEffect(() => {
    let current = true;
    setSource(undefined);
    if (!revision) return () => { current = false; };
    void loadProfilePhotoSource(profileId, revision).then((nextSource) => {
      if (current) setSource(nextSource);
    }).catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 404)) {
        // The initials fallback remains visible for transient and rendering failures.
      }
    });
    return () => { current = false; };
  }, [profileId, revision]);

  return (
    <span className={`profile-avatar ${compact ? "compact" : ""}`} aria-hidden="true">
      {source ? <img src={source} alt="" onError={() => setSource(undefined)} /> : profileInitials(displayName)}
    </span>
  );
}

function loadProfilePhotoSource(profileId: string | undefined, revision: string): Promise<string | undefined> {
  const cacheKey = `${profileId ?? "active"}:${revision}`;
  const cached = photoSourceCache.get(cacheKey);
  if (cached) return cached;

  const source = api.profilePhoto.get(profileId).then((photo) => photo.revision === revision
    ? `data:${photo.contentType};base64,${photo.contentBase64}`
    : undefined
  ).catch((error: unknown) => {
    photoSourceCache.delete(cacheKey);
    throw error;
  });
  photoSourceCache.set(cacheKey, source);
  return source;
}
