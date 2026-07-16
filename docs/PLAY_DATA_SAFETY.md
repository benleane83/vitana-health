# Play Data Safety Declaration

Use this declaration when completing Play Console Data Safety for `com.localfitnessadvisor.companion`. It derives from the [Health Connect Data Inventory](HEALTH_CONNECT_DATA_INVENTORY.md) and must be updated with it before release.

## Collected data

| Play data type | Collected | Purpose | Shared | Required |
| --- | --- | --- | --- | --- |
| Health and fitness: health information | Yes — user-selected Health Connect categories, manual entries, and approved health-report rows | App functionality: local wellness analytics and user-requested import | No. The companion transfers it only to the user's paired local desktop API. | No |
| Health and fitness: fitness information | Yes — only user-selected activity, exercise, distance, floors, and calorie categories in the inventory | App functionality: local fitness analytics and user-requested sync | No. The companion transfers it only to the user's paired local desktop API. | No |
| Device or other IDs | Yes — a random companion device ID | App functionality: secure pairing and sync deduplication | No | Yes for pairing and sync |
| Photos | Yes — only a report photo the user captures or selects | App functionality: PC-side OCR and review before health-data import | No. It travels only to the paired local desktop API and is not retained on the phone. | No |

The app does not collect contacts, location, financial information, messages, web browsing, app performance data, diagnostics, or advertising identifiers. It has no advertising, analytics, telemetry, sale, or third-party sharing SDKs.

## Security and deletion answers

- Data is encrypted in transit for production sync (HTTPS with certificate pinning).
- Imported health data is encrypted at rest in the paired desktop app; the companion token and device ID use Android secure storage.
- Users can request deletion by deleting observations or profiles in the paired desktop app; they can remove companion metadata and its token by disconnecting, and revoke the companion token from the desktop app.
- Health and fitness collection is optional: no categories are selected by default, and the companion presents a disclosure before requesting permission.
- Optional cloud-model processing is configured separately in the desktop app, requires per-profile consent, and is not a companion data-sharing path.
