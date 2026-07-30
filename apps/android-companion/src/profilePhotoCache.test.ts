import { describe, expect, it, vi } from "vitest";

// Only the naming and eviction rules are under test; the native filesystem is stubbed so this stays
// a plain node test, matching `standalone/databaseBackup.test.ts`.
vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { cache: "cache" }
}));

import { cacheProfilePhoto, profilePhotoFileName, type PhotoFileStore } from "./profilePhotoCache";

function fakeFiles(initial: string[] = []): PhotoFileStore & { files: Map<string, string> } {
  const files = new Map(initial.map((name) => [name, "old"]));
  return {
    files,
    write: (name, contentBase64) => {
      files.set(name, contentBase64);
      return `file:///cache/profile-photos/${name}`;
    },
    list: () => [...files.keys()],
    remove: (name) => {
      files.delete(name);
    }
  };
}

describe("profilePhotoFileName", () => {
  it("maps the content type onto an extension the image loader can recognise", () => {
    expect(profilePhotoFileName("rev-1", "image/png")).toBe("profile-photo-rev-1.png");
    expect(profilePhotoFileName("rev-1", "image/jpeg")).toBe("profile-photo-rev-1.jpg");
    expect(profilePhotoFileName("rev-1", "application/octet-stream")).toBe("profile-photo-rev-1.img");
  });

  it("strips path separators out of the revision so it cannot escape the cache directory", () => {
    expect(profilePhotoFileName("../../etc/passwd", "image/jpeg")).toBe("profile-photo-------etc-passwd.jpg");
  });
});

describe("cacheProfilePhoto", () => {
  it("writes the bytes and returns a file URI rather than a data URI", () => {
    const files = fakeFiles();
    const uri = cacheProfilePhoto({ contentBase64: "AAAA", contentType: "image/jpeg", revision: "rev-1" }, files);
    expect(uri).toBe("file:///cache/profile-photos/profile-photo-rev-1.jpg");
    expect(files.files.get("profile-photo-rev-1.jpg")).toBe("AAAA");
  });

  it("evicts earlier revisions but leaves unrelated files alone", () => {
    const files = fakeFiles(["profile-photo-rev-0.jpg", "something-else.db"]);
    cacheProfilePhoto({ contentBase64: "AAAA", contentType: "image/jpeg", revision: "rev-1" }, files);
    expect([...files.files.keys()].sort()).toEqual(["profile-photo-rev-1.jpg", "something-else.db"]);
  });
});
