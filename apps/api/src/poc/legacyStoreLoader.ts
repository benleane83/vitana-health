import { createDecipheriv, scryptSync } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parsePersistedHealthStore, type HealthStoreData } from "@local-fitness-advisor/shared";
import { z } from "zod";
import { assertPocRoot } from "./duckdbPoc.js";

const encryptedEnvelopeSchema = z.object({
  version: z.literal(1),
  salt: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
  iv: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
  tag: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
  payload: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/)
}).strict();

export interface LegacyStoreCopyResult {
  data: HealthStoreData;
  migrated: boolean;
}

export function loadLegacyStoreCopy(root: string, inputPath: string, passphrase: string): LegacyStoreCopyResult {
  const pocRoot = realpathSync(assertPocRoot(root));
  const inputRoot = realpathSync(resolve(pocRoot, "input-copy"));
  const resolvedInputPath = realpathSync(resolve(inputPath));
  if (!isWithin(inputRoot, resolvedInputPath) || !statSync(resolvedInputPath).isFile()) {
    throw new Error("Legacy health stores must be regular-file copies beneath the marked PoC input-copy directory.");
  }

  const envelope = encryptedEnvelopeSchema.parse(JSON.parse(readFileSync(resolvedInputPath, "utf8")));
  const salt = decodeBase64(envelope.salt, "salt", 16);
  const iv = decodeBase64(envelope.iv, "IV", 12);
  const tag = decodeBase64(envelope.tag, "authentication tag", 16);
  const payload = decodeBase64(envelope.payload, "payload");
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return parsePersistedHealthStore(JSON.parse(decrypted.toString("utf8")));
}

function decodeBase64(value: string, name: string, expectedLength?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    throw new Error(`Encrypted health store ${name} is invalid.`);
  }
  return decoded;
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent.length > 0 && pathFromParent !== ".." && !pathFromParent.startsWith("../") &&
    !pathFromParent.startsWith("..\\") && !isAbsolute(pathFromParent);
}