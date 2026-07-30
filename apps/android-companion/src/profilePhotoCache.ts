import { Directory, File, Paths } from "expo-file-system";

/**
 * Minimal file surface the photo cache needs. Kept injectable so the naming and eviction rules are
 * unit-testable without a device filesystem, matching the pattern in `standalone/databaseBackup.ts`.
 */
export interface PhotoFileStore {
  /** Writes base64-encoded bytes and returns the resulting `file://` URI. */
  write(name: string, contentBase64: string): string;
  /** File names currently in the cache directory. */
  list(): string[];
  remove(name: string): void;
}

/** Prefix that marks this cache's own files, so eviction can never touch anything else. */
export const profilePhotoPrefix = "profile-photo-";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function profilePhotoFileName(revision: string, contentType: string): string {
  const safeRevision = revision.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || "current";
  return `${profilePhotoPrefix}${safeRevision}.${extensions[contentType] ?? "img"}`;
}

/**
 * Writes the photo to disk and returns a `file://` URI. The bytes used to be kept in context state
 * as a base64 data URI for the lifetime of the app — roughly a third larger than the image itself,
 * held in JS heap, and re-encoded on every render that read it. Only one revision is ever kept.
 */
export function cacheProfilePhoto(
  photo: { contentBase64: string; contentType: string; revision: string },
  files: PhotoFileStore = deviceProfilePhotoStore()
): string {
  const name = profilePhotoFileName(photo.revision, photo.contentType);
  for (const existing of files.list()) {
    if (existing.startsWith(profilePhotoPrefix) && existing !== name) files.remove(existing);
  }
  return files.write(name, photo.contentBase64);
}

function fileNameFromUri(uri: string): string {
  const trimmed = uri.endsWith("/") ? uri.slice(0, -1) : uri;
  return decodeURIComponent(trimmed.slice(trimmed.lastIndexOf("/") + 1));
}

export function deviceProfilePhotoStore(): PhotoFileStore {
  // The cache directory is the right home: the OS may reclaim it, and a missing photo simply falls
  // back to the avatar on the next refresh.
  const directory = new Directory(Paths.cache, "profile-photos");
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
  return {
    write(name, contentBase64) {
      const file = new File(directory, name);
      if (!file.exists) file.create({ overwrite: true });
      file.write(contentBase64, { encoding: "base64" });
      return file.uri;
    },
    list: () => directory.list().map((entry) => fileNameFromUri(entry.uri)),
    remove: (name) => {
      const file = new File(directory, name);
      if (file.exists) file.delete();
    }
  };
}
