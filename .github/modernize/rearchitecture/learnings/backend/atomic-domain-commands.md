# Atomic Domain Commands

Compose related DuckDB writes under the repository transaction boundary and keep stable domain conflicts separate from validation errors.

## What Happened
The Care completion command needed to create a health event, update a care item, and append two audits atomically. The command reuses the existing health-event helper while `DuckDbRepository.transaction` owns commit and rollback. A dedicated `CareItemCompletionConflictError` maps non-open items to HTTP 409.

## Takeaway
Put multi-record orchestration in `duckdbCommands.ts`, expose it through `ProfileRepository`, and invoke it once through `DuckDbRepository.transaction`. Use `undefined` for missing records and a typed conflict error for invalid current state so routes can map 404 and 409 consistently.

## History
- 2026-07-25 (local-fitness-advisor/care-backend): initial