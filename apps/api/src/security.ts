import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import selfsigned from "selfsigned";

export interface RuntimeSecurity {
  ownerToken: string;
  tlsCertPath: string | null;
  tlsKeyPath: string | null;
  publicKeyHash: string | null;
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

export async function configureRuntimeSecurity(host: string): Promise<RuntimeSecurity> {
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
  if (!isLoopback && !tlsCertPath && !tlsKeyPath) {
    const generated = await loadOrCreateCertificate(dataDir);
    tlsCertPath = generated.certPath;
    tlsKeyPath = generated.keyPath;
    process.env.VITANA_TLS_CERT = tlsCertPath;
    process.env.VITANA_TLS_KEY = tlsKeyPath;
  }

  const publicKeyHash = tlsCertPath ? certificatePublicKeyHash(readFileSync(tlsCertPath, "utf8")) : null;
  return { ownerToken, tlsCertPath, tlsKeyPath, publicKeyHash };
}

export function certificatePublicKeyHash(certificatePem: string): string {
  const certificate = new X509Certificate(certificatePem);
  const publicKey = certificate.publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(publicKey).digest("base64");
}

function loadOrCreateOwnerToken(dataDir: string): string {
  const securityPath = path.join(dataDir, "security.json");
  if (existsSync(securityPath)) {
    const stored = JSON.parse(readFileSync(securityPath, "utf8")) as StoredSecurity;
    if (typeof stored.ownerToken === "string" && stored.ownerToken.length >= 24) return stored.ownerToken;
    throw new Error(`Invalid security settings at ${securityPath}.`);
  }
  const ownerToken = randomBytes(32).toString("base64url");
  writeFileSync(securityPath, JSON.stringify({ ownerToken } satisfies StoredSecurity, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  return ownerToken;
}

async function loadOrCreateCertificate(dataDir: string): Promise<{ certPath: string; keyPath: string }> {
  const tlsDir = path.join(dataDir, "tls");
  const certPath = path.join(tlsDir, "vitana.crt");
  const keyPath = path.join(tlsDir, "vitana.key");
  if (existsSync(certPath) !== existsSync(keyPath)) {
    throw new Error("The Vitana TLS certificate and key are incomplete. Restore the matching file from backup.");
  }
  if (existsSync(certPath) && existsSync(keyPath)) return { certPath, keyPath };

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
  writeFileSync(keyPath, certificate.private, { encoding: "utf8", mode: 0o600 });
  writeFileSync(certPath, certificate.cert, { encoding: "utf8", mode: 0o600 });
  return { certPath, keyPath };
}
