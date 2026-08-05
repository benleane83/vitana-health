This app (Vitana Health) is a local-first application that stores personal health data in an encrypted database. It started as a single-user application, but has been expanded to support multiple family member profiles including pets and children.

## Application status

Currently in development and not yet released. Planning to release it globally in two parts: an open PC app, and a paid mobile companion app (Android initially, then iOS later). The app will be for use on a local network only by design, but supporting multiple profiles so that family members can each maintain their own records in one instance.
Because I haven't released, backwards compatibility is not a concern. I just need to maintain compatibility over my local testing profiles, not full end-user migrations yet.
I'm only testing on Windows x64 currently, but I intend to support Linux and MacOS as well if the app is successful.

## Database design

Currently uses DuckDB as a local database, although considering SQLite as an alternative if transactional performance suffers. When working on database changes, please consider this and use abstractions over DuckDB where relevant to make swapping DB providers easier later. JSON profile support was in an earlier prototype but has been retired and should not be used actively. Earlier prototypes also performed full profile reads, but this is now discouraged for performance reasons.

## Schemas and Interoperability

My app's data structures have been designed to be lightweight but interoperable with global health standards like FHIR, LOINC, and Health Connect / HealthKit wherever practical. It does not replicate all fields and entities from those standards, but always use common naming and codes as references if possible so that we can map data from Vitana to those platforms easily.

## Mobile app design

My current mobile companion app was first designed for sync of Health Connect data only to the API layer of my PC app, but is being expanded to feature dashboards and copies of selected PC app features for mobiles. Android only for now, but I intend to support iOS later and publish in both App Stores. Use appropriate abstractions when adding native features to make iOS support easier.
Use the preview:web mode to preview mobile app from a web browser, and the demo mode to preview the app without a paired PC.

## Testing

This app uses a combination of unit tests, integration tests, and durability tests. Please keep this maintained, but don't bloat the suite with minimal value tests. My app is not in production yet, so I'd prefer a simple and robust test suite that can be run quickly, rather than a large and complex one that takes a long time to run.