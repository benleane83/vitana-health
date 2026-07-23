# Health Connect Declaration

Use this declaration for Google Play's Health apps / Health Connect form for `app.vitanahealth`. It derives from the [Health Connect Data Inventory](HEALTH_CONNECT_DATA_INVENTORY.md).

## Health Connect access

The companion requests read-only Health Connect access. It requests no category until the user selects it and acknowledges an in-app disclosure explaining the local wellness-analytics purpose, storage or local transfer behavior, and privacy-policy link. The default selection is empty; the initial history window defaults to 30 days and is selectable up to 365 days.

The Android manifest declares `android.permission.health.READ_HEALTH_DATA_HISTORY`. The app adds the corresponding `ReadHealthDataHistory` runtime request only when the user selects a sync window longer than 30 days (60, 90, 180, or 365 days). This access is needed solely to read the user-selected categories for that requested historical period. A 30-day selection does not request extended history access.

The requested record types are Steps, Heart Rate, Oxygen Saturation, Heart Rate Variability, Basal Metabolic Rate, Height, VO2 Max, Weight, Exercise Session, Distance, Active Calories Burned, Total Calories Burned, Sleep Session, and Body Fat.

For each type, the sole purpose is the corresponding local wellness, activity, sleep, fitness, or body-composition trend described in the inventory. Exercise and sleep details supplied by Health Connect are used only to present those local trends. The app does not write Health Connect records and does not use this data for advertising, sale, eligibility decisions, or any purpose other than the disclosed local app functionality.

## Data handling

In Standalone mode, selected records are stored in a SQLCipher-encrypted database on the phone. In Connected mode, selected records are sent only to the user-paired local desktop API through a pinned HTTPS connection in production and stored in the selected profile's encrypted desktop database. Standalone users can delete observations or reset local data. Connected users can delete observations or profiles, disconnect the companion, or revoke its token. See the public [Privacy Policy](PRIVACY_POLICY.md).
