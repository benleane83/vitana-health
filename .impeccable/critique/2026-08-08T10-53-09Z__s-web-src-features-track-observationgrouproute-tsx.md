---
target: my new measurement group feature
total_score: 21
p0_count: 0
p1_count: 3
timestamp: 2026-08-08T10-53-09Z
slug: s-web-src-features-track-observationgrouproute-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading and save states are present; an imported group's restricted state is too late and too generic. |
| 2 | Match System / Real World | 1 | `Provenance` and opaque scan filenames are system vocabulary, not health-record language. |
| 3 | User Control and Freedom | 1 | Group back navigation resets the user to Measurements; phone scans have no correction path. |
| 4 | Consistency and Standards | 3 | Familiar controls and data tables fit the wider product, but the View group link is detached from the row action pattern. |
| 5 | Error Prevention | 3 | Dirty-state protection and required fields are sound; accidental row removal has no inline recovery. |
| 6 | Recognition Rather Than Recall | 2 | The source has a label, but the page makes users infer what file IDs and read-only status mean. |
| 7 | Flexibility and Efficiency | 2 | Batch edit exists, but the fixed-width, five-column editor makes repeated edits slow on a phone. |
| 8 | Aesthetic and Minimalist Design | 3 | The calm evidence-led visual language is consistent; metadata and edit mode need more breathing room. |
| 9 | Error Recovery | 2 | Errors are surfaced, but imported and scanned groups offer no actionable recovery. |
| 10 | Help and Documentation | 1 | No source-specific explanation or correction alternative is offered. |
| **Total** | | **21/40** | **Functional foundation; important trust and workflow gaps** |

## Anti-Patterns Verdict

This does not read as generically AI-generated. It follows Vitana's calm, restrained product language, uses a plain data-first structure, and avoids decorative cards or invented controls. The weakness is not visual novelty: it is that source trust, editability, and navigation are implemented as internal rules instead of user-understandable decisions.

The deterministic detector reported zero findings for `apps/web/src/features/track/ObservationGroupRoute.tsx`. That is a clean result, but it does not cover the workflow defects here. Browser shell rendering was available, but the local API requests aborted, leaving the page in its loading state; this review therefore relies on source-level behavior for loaded and edit states.

## Overall Impression

The group page has the right skeleton: a clear title, recording time, source metadata, an observation table, and a batch editor. The biggest opportunity is to make it feel like the user owns their records. A phone scan should be editable or give a clear, safe correction workflow; it should never look like a mysterious immutable artifact.

## What's Working

- The grouping concept turns related observations into a useful record-level view rather than isolating each number.
- The API and page explicitly model editability, dirty state, save failure, and update concurrency, which protects records during batch edits.
- Source, recorded time, units, status, and reference context are all present in the information model, consistent with Vitana's evidence-led design system.

## Priority Issues

### [P1] Source policy removes agency from phone-scanned records

**Why it matters:** `duckdbProjections.ts` defines editable as `sourceKind === "manual-entry"`. That locks every imported and synchronized group alike, including phone scans, and returns the same vague reason. The user's own scan data feels broken rather than safeguarded.

**Fix:** Define editability as a source-specific policy. At minimum, phone-originated scans should support direct batch correction; if originals must remain immutable, offer a prominent `Correct this scan` flow that creates a linked corrected group while retaining the original. Keep external provider sync records immutable only where re-sync conflicts are real, and say why in plain language.

**Suggested command:** `$impeccable shape`

### [P1] Group navigation discards the user's context

**Why it matters:** `navigateObservationGroup()` clears `summaryDetailCode`, and `onBack` calls `navigate("track")`, which always returns to the Measurements landing page. Opening a group from a measurement detail and returning should be a reversible drill-down, not a reset.

**Fix:** Use history-aware back behavior as the default. Preserve the source measurement detail in the route state, then fall back to `/track` only for direct links with no prior local route. A compact breadcrumb can supplement, but should not replace browser/history behavior.

**Suggested command:** `$impeccable polish`

### [P1] Source metadata uses engineering language and leaks opaque filenames

**Why it matters:** The label `Provenance` and `importFileName` push a GUID or generated file name directly into a health-record screen. It does not help someone verify their data and distracts from the useful question: where did this record come from?

**Fix:** Replace `Provenance` with `Imported from` or `Record source`. Display a human-readable source description and import time, for example `Scanned with your Android companion on Aug 8, 2026`. Hide opaque/generated filenames; show a user-named file only when it is meaningful, perhaps in an optional disclosure labelled `Original file`.

**Suggested command:** `$impeccable clarify`

### [P2] View group is an under-prioritized text link in a dense measurement row

**Why it matters:** In `SummaryPage.tsx`, the block-level underlined link sits under source/note content. It consumes vertical space without reading as a row action, so it is easy to overlook and makes dense Track Detail rows taller.

**Fix:** Make the entire group affordance compact and relational: a small `N-record group` disclosure in the source line with a chevron, or add an icon-only group action beside Edit/Delete with an accessible label. Use a familiar drill-in target and remove the separate full-width text row.

**Suggested command:** `$impeccable distill`

### [P2] The editor compresses a multi-field task into a horizontal table

**Why it matters:** The page enforces an 8rem minimum width on every input/select inside a five-column table, inside a horizontal scroll wrapper. It gives too little whitespace between the header fields, rows, add action, errors, and save actions, and is particularly hostile on narrow screens.

**Fix:** Keep the compact table on desktop, but make each editable observation a vertically spaced field group below a mobile breakpoint. Give every group a measurement label, value/unit row, note, and a compact remove icon with a tooltip. Separate record-level fields, observation rows, and save actions into clear vertical regions with `space-5` to `space-6` rhythm.

**Suggested command:** `$impeccable adapt`

## Persona Red Flags

**Adult reviewing a phone-scanned lab result:** They recognize an OCR mistake, press into the group to correct it, then meet `Imported or synchronized groups are read-only to preserve their provenance.` This tells them neither what happened nor what to do. They need Edit or Correct this scan, plus a readable description of the source.

**Family health coordinator:** They drill from a measurement detail into a related group, compare the related values, and press Back. Returning to the generic Measurements landing page loses their exact thread, making repeated comparison laborious.

**Mobile-first self-tracker:** They add or correct several measurements. A horizontally scrollable row with Measurement, Value, Unit, Note, and Remove makes every correction a sideways navigation task. The form should stack by observation, not force a spreadsheet interaction onto a phone.

## Minor Observations

- Deleting a row before Save has no restore affordance. Keep a short-lived undo or a visible removed state until Save.
- `Recorded date and time` is appropriate, but source-specific helper text would explain whether changing it updates the whole group or each measurement.
- The group table's measurement names are useful drill-ins. Make the distinction between navigating to a measurement and editing the group clear when both actions are present.

## Questions to Consider

- Is a phone scan a user-owned draft that should be corrected directly, or an immutable source that needs a deliberate corrected-copy relationship?
- Which source types are genuinely immutable because a later sync could overwrite them, and which were merely classified as non-manual by implementation convenience?
- Can a group be understood as a single health-record event first, with source evidence as supporting detail rather than primary metadata?
