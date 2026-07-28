# Vitana Health Privacy Policy

**Effective date: July 20, 2026**

Vitana Health is a local-first wellness application. This policy applies to the Vitana Android app and its paired Vitana Health desktop API.

## Information we collect

The companion reads only the Health Connect categories that you choose: steps, heart rate, oxygen saturation, heart-rate variability, basal metabolic rate, height, VO2 max, weight, exercise sessions, distance, active calories, total calories, sleep sessions, and body fat. No Health Connect category is selected by default, and the first import defaults to 30 days (you may choose 30, 60, 90, 180, or 365 days). The complete category, field, and purpose inventory is in the [Health Connect Data Inventory](HEALTH_CONNECT_DATA_INVENTORY.md).

The companion also processes a random device identifier, pairing and connection metadata (the local server URL, public-key hash, pairing token, assigned profile ID, selections, sync cursor, and last-sync time), and camera/gallery access for QR pairing and health-report capture. It does not retain report images, OCR text, or review drafts. Dashboard, Track, and Care records are stored in the encrypted mobile database for local use or read-only offline viewing while paired.

## How we use and transfer information

Before pairing, the companion saves selected Health Connect records and manual entries to an encrypted local database on the phone and uses them for local wellness analytics. Once pairing is activated, it sends selected records to the single assigned desktop profile. Report images travel only over the paired local connection for PC-side OCR and parsing, and you review rows before committing them. The desktop API uses committed data for local wellness analytics, deduplicated sync, and optional clinician-report exports. Health data is not used for advertising, sold, or used for eligibility decisions.

Connected-mode health transfers go only to the local API endpoint that you pair. Production transfers require HTTPS and use the certificate public-key hash obtained during pairing to pin that connection. A development build may permit cleartext traffic only when its developer explicitly enables it. The companion does not provide cloud backup, advertising, telemetry, or product analytics. It contacts Expo's EAS Update service to check for and download app updates; those requests may include ordinary network, device, app-version, runtime, and update-request metadata, but Vitana does not send personal health records to Expo.

## Storage, retention, and deletion

Before pairing, the Android app stores health data in a local SQLCipher-encrypted SQLite database. Its database key is kept in Android secure storage and is restricted to the device. After pairing is activated, the desktop app stores the authoritative imported health data in the assigned profile's local AES-256-GCM encrypted DuckDB database. The phone keeps an identity-bound, read-only Dashboard, Track, and Care replica in its SQLCipher database for immediate and offline viewing. Connection metadata is stored on the phone, and the pairing token and device identifier use Android secure storage. Report images and OCR drafts are cleared after commit, cancellation, unpairing, or app backgrounding.

There is no automatic health-data expiration or eviction. Before pairing, data remains in the encrypted mobile database until you delete observations or reset local data. After pairing is activated, authoritative data remains until you delete individual observations, delete observations by type, or delete the profile in the desktop app; deleting a profile removes its local encrypted database. Unpairing deletes the phone's downloaded replica, local connection record, and pairing token, and creates a fresh empty local profile without changing desktop data. Revoking a companion in the desktop app prevents its token from further access. Your Health Connect source data remains subject to the controls of Health Connect and its originating apps.

## Optional cloud-model processing

Local analytics and a locally configured Ollama model stay on the device. If you explicitly enable a cloud model for a profile in the desktop app, that separate feature may send a minimized, redacted question and bounded structured query results to the cloud provider you configure. It requires recorded per-profile consent and is not part of the Android Health Connect sync. Do not enable it unless you accept that provider's privacy terms.

## Security

We protect companion transfers with HTTPS, certificate pinning, pairing approval, and revocable companion tokens. At rest, the desktop app encrypts profile databases with AES-256-GCM, while local phone data uses a SQLCipher-encrypted database with its key in Android secure storage. The Android companion also uses secure storage for its token and device identifier. No security control can guarantee protection against every risk, especially on an unlocked or compromised device.

## Contact

For privacy questions or requests, contact the maintainer through [https://github.com/benleane83](https://github.com/benleane83). To report a security issue, follow the private reporting instructions in [SECURITY.md](../SECURITY.md) rather than posting sensitive details publicly.

## Changes

We will update this policy before materially changing the categories collected, purposes, transfer destinations, or retention practices. The current version is published at this stable URL: `https://www.vitanahealth.app/privacy`.
