/**
 * Why the local database could not be opened. Callers need to tell these apart: a missing key means
 * the ciphertext is unrecoverable and the only path forward is a reset, whereas unreadable data may
 * be transient (a locked file, a half-written WAL) and must not trigger key destruction.
 */
export type LocalDatabaseFailureReason =
  | "key-missing"
  | "data-unreadable"
  | "sqlcipher-unavailable"
  | "migration-failed";

export class LocalDatabaseError extends Error {
  constructor(
    readonly reason: LocalDatabaseFailureReason,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "LocalDatabaseError";
  }
}

/**
 * `read-only` is entered when the file was written by a newer build. The app stays usable for
 * viewing rather than refusing to start, because a downgrade is a recoverable situation.
 */
export type LocalDatabaseMode = "read-write" | "read-only";

export function isLocalDatabaseError(error: unknown): error is LocalDatabaseError {
  return error instanceof LocalDatabaseError;
}
