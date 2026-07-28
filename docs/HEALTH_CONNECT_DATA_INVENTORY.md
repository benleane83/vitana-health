# Health Connect Data Inventory

This is the source inventory for the Android companion's privacy policy, Play Data Safety declaration, and Health Connect declaration. The companion requests **read** access only after the user selects a category and acknowledges the in-app disclosure. Nothing is selected by default.

The initial history window defaults to 30 days. If the user selects 60, 90, 180, or 365 days, the app also requests `android.permission.health.READ_HEALTH_DATA_HISTORY` so Health Connect can return the selected categories for that extended period.

| Health Connect category | Data received | Purpose |
| --- | --- | --- |
| Steps | Step counts and times | Local activity trends |
| Heart rate | Heart-rate samples | Local wellness trends |
| Oxygen saturation | Oxygen-saturation samples | Local wellness trends |
| Heart-rate variability | RMSSD samples | Local wellness trends |
| Basal metabolic rate | Energy-rate samples | Local wellness trends |
| Height | Height values | Local wellness trends |
| VO2 max | VO2-max samples | Local fitness trends |
| Weight | Weight values | Local wellness trends |
| Exercise sessions | Session times, activity type, energy, distance, title, notes, and record metadata when supplied by Health Connect | Local activity trends |
| Distance | Distance values and times | Local activity trends |
| Active calories burned | Energy values and times | Local activity trends |
| Total calories burned | Energy values and times | Local activity trends |
| Sleep sessions | Session times, duration, stages, title, notes, and record metadata when supplied by Health Connect | Local sleep trends |
| Body fat | Body-fat percentage | Local body-composition trends |

The companion also generates a random device identifier, retains the paired endpoint URL, public-key hash, selected categories, selected initial sync window, sync cursor, and last-sync time. It keeps the pairing token and device identifier in Android secure storage. Camera access is used only to scan a pairing QR code; camera images are not uploaded or retained.

Before pairing, the mobile app stores approved imports in its SQLCipher-encrypted local database and keeps the encryption key in Android secure storage. Once paired and activated, the desktop API stores approved imports in the selected profile's local encrypted database. The app uses the data for local wellness analytics, optional clinician-report export, and sync deduplication. It does not use Health Connect data for advertising, sale, or credit, employment, insurance, or other eligibility decisions.

See [Privacy Policy](PRIVACY_POLICY.md), [Play Data Safety Declaration](PLAY_DATA_SAFETY.md), and [Health Connect Declaration](HEALTH_CONNECT_DECLARATION.md).
