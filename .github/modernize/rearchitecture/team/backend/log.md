# Backend Session Log

## [care-backend] Implement Care storage and completion API
- DuckDB v10 must drop dependent AI views before dropping retired columns, then recreate the views in the same migration transaction.
- Multi-record domain commands belong inside `DuckDbRepository.transaction`; command helpers may compose existing command functions so their writes and audits share the outer transaction.
- Generic care-item edits preserve completion status, timestamp, and event provenance once completed; only the dedicated completion command can establish that provenance.
- A concurrent full API test run can exceed unrelated 5-second route-test limits; `--maxWorkers=1` passed all 163 tests.
- Learnings consumed: [(none)]