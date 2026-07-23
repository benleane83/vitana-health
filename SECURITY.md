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

Vitana Health is a **local-first, multi-profile wellness application**. Understanding its threat model helps frame which issues are in scope.

### In-scope threats

- **LAN API exposure:** the API binds to a LAN address when the Android companion is paired; authentication and transport security (TLS + certificate pinning) protect this path, but weaknesses in those controls are in scope.
- **Encrypted store:** each profile uses a separate AES-256-GCM encrypted DuckDB database. The packaged desktop wraps its data key with the operating system's secure storage; standalone production API deployments require an explicit secret. Weaknesses in encryption, key handling, profile isolation, atomic database promotion, or backup/recovery are in scope.
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

The desktop app stores personal health data in separate encrypted local DuckDB databases. Android Standalone mode uses an encrypted local SQLCipher database. Vitana has **no telemetry or health-data cloud sync**. The Android app contacts Expo's EAS Update service for app updates but does not send personal health records to it. The only optional health-data path to a cloud provider is minimized model prompt content when you configure that provider yourself and record explicit consent for the profile.

If you discover a defect that could cause health data to leave the device unexpectedly, or to be accessible to other local users or processes without authorization, treat it as a high-severity security vulnerability and report it privately.

## Non-medical use

This application generates wellness-oriented summaries intended to support conversations with a clinician. **It does not diagnose conditions, prescribe treatment, recommend medication changes, or handle urgent medical concerns.** Security issues that could cause the application to imply medical advice beyond these boundaries are in scope.

## Backup and recovery

Vitana supports portable, password-protected backups of encrypted profile data. Restore hydrates each selected profile into a staged encrypted database, verifies parity, and promotes it only after hydration succeeds. Restore journals support compensation and startup recovery if a multi-profile operation is interrupted.

- Store backup files and their passwords separately.
- Keep more than one tested backup when the records are important to you.
- Loss of the packaged desktop's OS-protected data key can make local profile databases unreadable; a portable backup remains independently recoverable with its backup password.
- Standalone production API deployments must preserve their configured `VITANA_SECRET` securely.
