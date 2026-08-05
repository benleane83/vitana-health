import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import selfsigned from "selfsigned";

export interface RuntimeSecurity {
  ownerToken: string;
  tlsCertPath: string | null;
  tlsKeyPath: string | null;
  publicKeyHash: string | null;
  certificateFingerprint: string | null;
}

interface StoredSecurity {
  ownerToken: string;
}

export function getLanAddresses(): string[] {
  const addresses = new Set<string>();
  for (const interfaceList of Object.values(os.networkInterfaces())) {
    for (const entry of interfaceList ?? []) {
      if (!entry.internal && entry.family === "IPv4") addresses.add(entry.address);
    }
  }
  return [...addresses];
}

export async function configureRuntimeSecurity(
  host: string,
  options: { requireTls?: boolean } = {}
): Promise<RuntimeSecurity> {
  const dataDir = path.resolve(process.env.VITANA_DATA_DIR ?? "data");
  mkdirSync(dataDir, { recursive: true });

  const ownerToken = process.env.VITANA_OWNER_TOKEN ?? loadOrCreateOwnerToken(dataDir);
  if (ownerToken.length < 24) throw new Error("VITANA_OWNER_TOKEN must be at least 24 characters.");
  process.env.VITANA_OWNER_TOKEN = ownerToken;

  const configuredCert = process.env.VITANA_TLS_CERT;
  const configuredKey = process.env.VITANA_TLS_KEY;
  if (Boolean(configuredCert) !== Boolean(configuredKey)) {
    throw new Error("VITANA_TLS_CERT and VITANA_TLS_KEY must be configured together.");
  }

  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  let tlsCertPath = configuredCert ? path.resolve(configuredCert) : null;
  let tlsKeyPath = configuredKey ? path.resolve(configuredKey) : null;
  if ((!isLoopback || options.requireTls) && !tlsCertPath && !tlsKeyPath) {
    const generated = await loadOrCreateCertificate(dataDir);
    tlsCertPath = generated.certPath;
    tlsKeyPath = generated.keyPath;
    process.env.VITANA_TLS_CERT = tlsCertPath;
    process.env.VITANA_TLS_KEY = tlsKeyPath;
  }

  const certificatePem = tlsCertPath ? readFileSync(tlsCertPath, "utf8") : null;
  const publicKeyHash = certificatePem ? certificatePublicKeyHash(certificatePem) : null;
  const certificateFingerprint = certificatePem
    ? new X509Certificate(certificatePem).fingerprint256
    : null;
  return { ownerToken, tlsCertPath, tlsKeyPath, publicKeyHash, certificateFingerprint };
}

export function certificatePublicKeyHash(certificatePem: string): string {
  const certificate = new X509Certificate(certificatePem);
  const publicKey = certificate.publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(publicKey).digest("base64");
}

function loadOrCreateOwnerToken(dataDir: string): string {
  const securityPath = path.join(dataDir, "security.json");
  try {
    return parseOwnerToken(readFileSync(securityPath, "utf8"), securityPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const ownerToken = randomBytes(32).toString("base64url");
  const content = JSON.stringify({ ownerToken } satisfies StoredSecurity, null, 2);
  try {
    writeFileSync(securityPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return ownerToken;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return parseOwnerToken(readFileSync(securityPath, "utf8"), securityPath);
  }
}

function parseOwnerToken(value: string, securityPath: string): string {
  const stored = JSON.parse(value) as StoredSecurity;
  if (typeof stored.ownerToken === "string" && stored.ownerToken.length >= 24) return stored.ownerToken;
  throw new Error(`Invalid security settings at ${securityPath}.`);
}

/** Reads a file, treating "not there" as a value rather than an error. */
function readIfPresent(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function loadOrCreateCertificate(dataDir: string): Promise<{ certPath: string; keyPath: string }> {
  const tlsDir = path.join(dataDir, "tls");
  const certPath = path.join(tlsDir, "vitana.crt");
  const keyPath = path.join(tlsDir, "vitana.key");
  // Read rather than stat, so the decision is made from the bytes we actually hold instead of a
  // separate existence check the filesystem could invalidate before the write below.
  const existingCert = readIfPresent(certPath);
  const existingKey = readIfPresent(keyPath);
  if ((existingCert === undefined) !== (existingKey === undefined)) {
    throw new Error("The Vitana TLS certificate and key are incomplete. Restore the matching file from backup.");
  }
  if (existingCert !== undefined && existingKey !== undefined) return { certPath, keyPath };

  mkdirSync(tlsDir, { recursive: true });
  const notBeforeDate = new Date();
  notBeforeDate.setMinutes(notBeforeDate.getMinutes() - 5);
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 5);
  const altNames: Array<{ type: 2; value: string } | { type: 7; ip: string }> = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...getLanAddresses().map((ip): { type: 7; ip: string } => ({ type: 7, ip }))
  ];
  const certificate = await selfsigned.generate([{ name: "commonName", value: "Vitana" }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", digitalSignature: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames }
    ]
  });
  // `wx` refuses to follow or clobber a file that appeared since the existence check above, so a
  // pre-planted symlink cannot redirect the private key. A partial pair is removed rather than
  // left behind, because the check above rejects a lone certificate or key on the next startup.
  try {
    writeFileSync(keyPath, certificate.private, { encoding: "utf8", mode: 0o600, flag: "wx" });
    writeFileSync(certPath, certificate.cert, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    rmSync(keyPath, { force: true });
    rmSync(certPath, { force: true });
    throw error;
  }
  return { certPath, keyPath };
}
