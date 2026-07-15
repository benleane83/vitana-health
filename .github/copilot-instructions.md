This application (working title Local Fitness Advisor) is a local-first, single-user application that stores personal health data in an encrypted local database. It started as a single-user application, but has been expanded to support multiple family member profiles including pets and children.

## Application status

Currently in development and is not yet released. Planning to release it globally in two parts: an open PC app, and a paid mobile companion app (Android initially, then iOS later). The app will be for use on a local network only by design, but I intend to support multiple profiles so that family members can each maintain their own records in one app instance.
Because I haven't released, backwards compatibility is not a concern yet. I just need to maintain compatibility over my local testing profiles, but not full end-user migrations yet.
I'm only testing on Windows x64 currently, but I intend to support Linux and MacOS as well if the app is successful.

## Database design

Currently uses DuckDB as a local database, although considering SQLite as an alternative if transactional performance suffers. When working on database changes, please consider this and use abstractions over DuckDB where relevant to make swapping DB providers easier later. JSON profile support was in an earlier prototype but has been retired and should not be used actively. Earlier prototypes also performed full profile reads, but this is now discouraged for performance reasons.

## Mobile app design

My current mobile companion app is designed for sync of Health Connect data only to the API layer of my PC app. My longer term plan is to expand the mobile app to feature dashboards and copies of selected PC app features for the mobile device. Implementation hasn't started yet, but keep this in mind when developing PC features so they can be easily exposed/mirrored later.