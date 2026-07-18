# Health Connect Data Inventory

This is the source inventory for the Android companion's privacy policy, Play Data Safety declaration, and Health Connect declaration. The companion requests **read** access only after the user selects a category and acknowledges the in-app disclosure. Nothing is selected by default.

| Health Connect category | Data received | Purpose |
| --- | --- | --- |
| Steps | Step counts and times | Local activity trends |
| Heart rate | Heart-rate samples | Local wellness trends |
| Oxygen saturation | Oxygen-saturation samples | Local wellness trends |
| Respiratory rate | Respiratory-rate samples | Local wellness trends |
| Heart-rate variability | RMSSD and SDNN samples | Local wellness trends |
| Basal body temperature | Temperature samples | Local wellness trends |
| Basal metabolic rate | Energy-rate samples | Local wellness trends |
| Blood glucose | Glucose samples | Local wellness trends |
| Blood pressure | Systolic and diastolic samples | Local wellness trends |
| Body temperature | Temperature samples | Local wellness trends |
| Height | Height values | Local wellness trends |
| VO2 max | VO2-max samples | Local fitness trends |
| Weight | Weight values | Local wellness trends |
| Exercise sessions | Session times, activity type, energy, distance, title, notes, and record metadata when supplied by Health Connect | Local activity trends |
| Distance | Distance values and times | Local activity trends |
| Floors climbed | Floor counts and times | Local activity trends |
| Active calories burned | Energy values and times | Local activity trends |
| Total calories burned | Energy values and times | Local activity trends |
| Sleep sessions | Session times, duration, stages, title, notes, and record metadata when supplied by Health Connect | Local sleep trends |
| Body fat | Body-fat percentage | Local body-composition trends |
| Lean body mass | Lean-mass values | Local body-composition trends |
| Body water mass | Water-mass values | Local body-composition trends |
| Bone mass | Bone-mass values | Local body-composition trends |

The companion also generates a random device identifier, retains the paired endpoint URL, public-key hash, selected categories, selected initial sync window, sync cursor, and last-sync time. It keeps the pairing token and device identifier in Android secure storage. Camera access is used only to scan a pairing QR code; camera images are not uploaded or retained.

The desktop API stores approved imports in the selected profile's local encrypted database. The app uses the data for local wellness analytics, optional clinician-report export, and sync deduplication. It does not use Health Connect data for advertising, sale, or credit, employment, insurance, or other eligibility decisions.

See [Privacy Policy](PRIVACY_POLICY.md), [Play Data Safety Declaration](PLAY_DATA_SAFETY.md), and [Health Connect Declaration](HEALTH_CONNECT_DECLARATION.md).
