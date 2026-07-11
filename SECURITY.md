# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main` (latest commit) | ✅ Active |
| Older tagged releases | ❌ No backports |

Security fixes are applied to `main` only. If you are running a pinned release, update to the latest commit to receive patches.

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Report vulnerabilities by emailing the maintainer directly. You can find contact information on the [GitHub profile](https://github.com/benleane83). Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept (a working exploit is not required).
- The version or commit hash you tested against.
- Any suggested mitigations, if you have them.

You will receive an acknowledgement within **72 hours**. If you do not hear back, send a follow-up.

### Coordinated disclosure

We follow a **90-day coordinated disclosure window**. We will work with you to understand and fix the issue, then publish a security advisory alongside the fix. We will credit reporters by name unless you ask to remain anonymous.

We will not take legal action against researchers who act in good faith under this policy.

## Threat model

Local Fitness Advisor is a **local-first, single-user application**. Understanding its threat model helps frame which issues are in scope.

### In-scope threats

- **LAN API exposure:** the API binds to a LAN address when the Android companion is paired; authentication and transport security (TLS + certificate pinning) protect this path, but weaknesses in those controls are in scope.
- **Encrypted store:** the encrypted health store and its key (`data/local.key`) are colocated on disk by default. Any weakness in the encryption scheme, key derivation, atomic write path, or backup/recovery logic is in scope.
- **Companion authentication:** the QR pairing flow, short-lived pairing codes, polling secrets, and companion token revocation are in scope.
- **Injection and input validation:** SQL injection, path traversal, and request-body parsing weaknesses in the API are in scope.
- **Dependency vulnerabilities:** exploitable CVEs in direct or transitive dependencies are in scope.
- **Cloud prompt leakage:** if cloud model mode is enabled, weaknesses that cause more health data to be serialized into prompts than the documented minimization policy allows are in scope.

### Out-of-scope

- Attacks that require physical access to an already-unlocked device running the app.
- Vulnerabilities in the OS, Ollama, or third-party cloud model providers.
- Social-engineering attacks against the user.
- Issues that require the attacker to already possess the owner credential or the encryption key.

## Privacy and health data

The app stores personal health data in an AES-GCM encrypted local file. It has **no telemetry, cloud sync, or vendor data upload paths**. The only optional off-device data path is model prompt text when you configure a cloud provider yourself — and only after explicit per-profile consent.

If you discover a defect that could cause health data to leave the device unexpectedly, or to be accessible to other local users or processes without authorization, treat it as a high-severity security vulnerability and report it privately.

## Non-medical use

This application generates wellness-oriented summaries intended to support conversations with a clinician. **It does not diagnose conditions, prescribe treatment, recommend medication changes, or handle urgent medical concerns.** Security issues that could cause the application to imply medical advice beyond these boundaries are in scope.

## Backup and recovery

The encrypted store is written atomically with a `.bak` backup maintained alongside it. If the primary store is corrupted, the API will attempt to restore from the backup automatically at startup.

- **Back up `data/`** (or the application-data directory for the packaged desktop app) regularly.
- **Back up `data/local.key`** separately from the encrypted store and store it securely. Loss of the key means loss of access to your health data.
- The `.enc` and `.enc.bak` files cannot be read without the key.
