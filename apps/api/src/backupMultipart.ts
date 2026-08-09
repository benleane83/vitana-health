import Busboy from "busboy";
import type express from "express";
import {
  BACKUP_DECISIONS_MAX_BYTES,
  BACKUP_MAX_SIZE_BYTES,
  BACKUP_PASSPHRASE_MAX_BYTES
} from "@vitana/shared";

export interface BackupMultipartBody {
  file: Buffer;
  passphrase: string;
  decisions?: unknown;
}

export class BackupMultipartError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "BackupMultipartError";
  }
}

export function parseBackupMultipart(
  request: express.Request,
  options: { requireDecisions: boolean }
): Promise<BackupMultipartBody> {
  return new Promise((resolve, reject) => {
    let parser: Busboy.Busboy;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          fieldNameSize: 32,
          fieldSize: BACKUP_DECISIONS_MAX_BYTES,
          fields: options.requireDecisions ? 3 : 2,
          fileSize: BACKUP_MAX_SIZE_BYTES,
          files: 2,
          parts: options.requireDecisions ? 4 : 3
        }
      });
    } catch {
      reject(new BackupMultipartError("multipart/form-data body required.", "MULTIPART_REQUIRED"));
      return;
    }

    let settled = false;
    let file: Buffer | undefined;
    let fileSeen = false;
    let fileTooLarge = false;
    let passphrase: string | undefined;
    let decisionsText: string | undefined;
    let pendingError: Error | undefined;

    const fail = (error: Error): void => {
      pendingError ??= error;
    };

    const failImmediately = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    parser.on("file", (name, stream) => {
      if (name !== "file" || fileSeen) {
        stream.resume();
        fail(new BackupMultipartError("Exactly one backup file field is required.", "FILE_INVALID"));
        return;
      }
      fileSeen = true;
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("limit", () => {
        fileTooLarge = true;
        failImmediately(new BackupMultipartError("Backup file exceeds maximum size.", "PAYLOAD_TOO_LARGE", 413));
        stream.destroy();
        request.destroy();
      });
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (!fileTooLarge) chunks.push(chunk);
      });
      stream.on("end", () => {
        if (!fileTooLarge) file = Buffer.concat(chunks, size);
      });
    });

    parser.on("field", (name, value, info) => {
      if (info.valueTruncated) {
        fail(new BackupMultipartError(`Multipart field "${name}" is too large.`, "FIELD_TOO_LARGE", 413));
        return;
      }
      if (name === "passphrase") {
        if (Buffer.byteLength(value) > BACKUP_PASSPHRASE_MAX_BYTES) {
          fail(new BackupMultipartError("Passphrase field is too large.", "FIELD_TOO_LARGE", 413));
          return;
        }
        passphrase = value;
      } else if (name === "decisions" && options.requireDecisions) {
        decisionsText = value;
      } else {
        fail(new BackupMultipartError(`Unexpected multipart field "${name}".`, "FIELD_INVALID"));
      }
    });

    parser.on("filesLimit", () => fail(new BackupMultipartError("Only one backup file is allowed.", "FILE_INVALID")));
    parser.on("fieldsLimit", () => fail(new BackupMultipartError("Too many multipart fields.", "FIELD_INVALID")));
    parser.on("partsLimit", () => fail(new BackupMultipartError("Too many multipart parts.", "FIELD_INVALID")));
    parser.on("error", () => fail(new BackupMultipartError("Malformed multipart body.", "MULTIPART_INVALID")));
    request.on("aborted", () => failImmediately(new BackupMultipartError("Backup upload was cancelled.", "UPLOAD_ABORTED")));
    request.on("error", () => failImmediately(new BackupMultipartError("Error reading backup upload.", "READ_ERROR")));

    parser.on("close", () => {
      if (settled) return;
      if (pendingError) {
        failImmediately(pendingError);
        return;
      }
      if (fileTooLarge) {
        failImmediately(new BackupMultipartError("Backup file exceeds maximum size.", "PAYLOAD_TOO_LARGE", 413));
        return;
      }
      if (!file || file.length === 0) {
        failImmediately(new BackupMultipartError("Backup file field required.", "FILE_REQUIRED"));
        return;
      }
      if (!passphrase) {
        failImmediately(new BackupMultipartError("Passphrase field required.", "PASSPHRASE_REQUIRED"));
        return;
      }

      let decisions: unknown;
      if (options.requireDecisions) {
        if (decisionsText === undefined) {
          failImmediately(new BackupMultipartError("Decisions field required.", "DECISIONS_REQUIRED"));
          return;
        }
        try {
          decisions = JSON.parse(decisionsText);
        } catch {
          failImmediately(new BackupMultipartError("Decisions field must contain valid JSON.", "DECISIONS_INVALID"));
          return;
        }
      }
      settled = true;
      resolve({ file, passphrase, ...(options.requireDecisions ? { decisions } : {}) });
    });

    request.pipe(parser);
  });
}