# Health Connect Declaration

Use this declaration for Google Play's Health apps / Health Connect form for `com.localfitnessadvisor.companion`. It derives from the [Health Connect Data Inventory](HEALTH_CONNECT_DATA_INVENTORY.md).

## Health Connect access

The companion requests read-only Health Connect access. It requests no category until the user selects it and acknowledges an in-app disclosure explaining the local wellness-analytics purpose, local transfer, and privacy-policy link. The default selection is empty; the initial history window defaults to 30 days and is selectable up to 365 days.

The requested record types are Steps, Heart Rate, Oxygen Saturation, Respiratory Rate, Heart Rate Variability, Basal Body Temperature, Basal Metabolic Rate, Blood Glucose, Blood Pressure, Body Temperature, Height, VO2 Max, Weight, Exercise Session, Distance, Floors Climbed, Active Calories Burned, Total Calories Burned, Sleep Session, Body Fat, Lean Body Mass, Body Water Mass, and Bone Mass.

For each type, the sole purpose is the corresponding local wellness, activity, sleep, fitness, or body-composition trend described in the inventory. Exercise and sleep details supplied by Health Connect are used only to present those local trends. The app does not write Health Connect records and does not use this data for advertising, sale, eligibility decisions, or any purpose other than the disclosed local app functionality.

## Data handling

Selected records are sent only to the user-paired local desktop API through a pinned HTTPS connection in production. The desktop app stores imports in the selected profile's encrypted local database. Users can delete observations or profiles there, disconnect the companion, or revoke its token. See the public [Privacy Policy](PRIVACY_POLICY.md).
