# Play Data Safety Declaration

Use this declaration when completing Play Console Data Safety for `app.vitanahealth`. It derives from the [Health Connect Data Inventory](HEALTH_CONNECT_DATA_INVENTORY.md) and must be updated with it before release.

## Collected data

| Play data type | Collected | Purpose | Shared | Required |
| --- | --- | --- | --- | --- |
| Health and fitness: health information | Yes — user-selected heart rate, oxygen saturation, heart-rate variability, basal metabolic rate, height, weight, sleep, and body-fat Health Connect categories; manual entries; and approved health-report rows | App functionality: encrypted on-device wellness analytics before pairing or user-requested import to a paired PC after activation | No. Local-only data remains on the phone; paired use transfers selected data only to the user's local desktop API. | No |
| Health and fitness: fitness information | Yes — only user-selected activity, exercise, distance, and calorie categories in the inventory | App functionality: encrypted on-device fitness analytics before pairing or user-requested sync to a paired PC after activation | No. Local-only data remains on the phone; paired use transfers selected data only to the user's local desktop API. | No |
| Device or other IDs | Yes — a random companion device ID | App functionality: secure pairing and sync deduplication | No | Yes for pairing and sync |
| Photos | Yes — only a report photo the user captures or selects | App functionality: PC-side OCR and review before health-data import | No. It travels only to the paired local desktop API and is not retained on the phone. | No |

The app does not collect contacts, location, financial information, messages, web browsing, or advertising identifiers. It has no advertising, product analytics, telemetry, sale, or health-data sharing SDKs. EAS Update contacts Expo to check for and download app updates and may transmit ordinary network, device, app-version, runtime, and update-request metadata. Personal health records are not included in those update requests. The release owner must keep the Play Console answers consistent with Expo's current EAS Update data disclosures for the shipped SDK version.

## Security and deletion answers

- Data is encrypted in transit for production sync (HTTPS with certificate pinning).
- Imported health data is encrypted at rest in a SQLCipher database on the phone for local use and read-only paired offline viewing, while the paired desktop database remains authoritative after activation; mobile database keys, companion tokens, and device IDs use Android secure storage.
- Local-only users can delete observations or reset local data. Paired users can delete observations or profiles in the desktop app, remove the downloaded phone replica, companion metadata, and token by unpairing, and revoke the companion token from the desktop app.
- Health and fitness collection is optional: no categories are selected by default, and the companion presents a disclosure before requesting permission.
- Optional cloud-model processing is configured separately in the desktop app, requires per-profile consent, and is not a companion data-sharing path.
