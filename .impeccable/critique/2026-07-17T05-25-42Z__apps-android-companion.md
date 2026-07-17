---
target: critique my mobile app UI under /apps/android-companion
total_score: 20
p0_count: 0
p1_count: 3
timestamp: 2026-07-17T05-25-42Z
slug: apps-android-companion
---
# Android Companion UI Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|------:|-----------|
| 1 | Visibility of System Status | 2 | Pairing stages are clear, but import feedback is generic and “refreshed just now” is not timestamp-derived. |
| 2 | Match System / Real World | 2 | Raw connection states, measurement codes, units, and `record(s)` expose implementation language. |
| 3 | User Control and Freedom | 3 | Pairing and scan review support cancel/retry; imports lack undo and interruption recovery. |
| 4 | Consistency and Standards | 2 | Native conventions are sound, but PairScreen, shared mobile UI, and web use different visual vocabularies. |
| 5 | Error Prevention | 1 | Free-text measurement codes, units, and values permit high-trust data errors. |
| 6 | Recognition Rather Than Recall | 2 | Destinations are visible, but pairing requires cross-device recall and Track offers little interpretation. |
| 7 | Flexibility and Efficiency | 2 | Search, sort, presets, and pagination help; bulk selection and recommended category controls are absent. |
| 8 | Aesthetic and Minimalist Design | 2 | Calm but generic; repeated cards and chip walls flatten hierarchy. |
| 9 | Error Recovery | 2 | Errors are readable but often lack field-level diagnosis or direct recovery actions. |
| 10 | Help and Documentation | 2 | Pairing/privacy guidance is useful; Track terminology, chart meaning, and validation lack contextual help. |
| **Total** | | **20/40** | **Acceptable foundation; significant pre-release trust and usability work remains.** |

## Anti-Patterns Verdict

**LLM assessment:** Moderate product-slop risk, not decorative AI slop. The companion avoids glassmorphism, ornamental gradients, oversized type, and gratuitous motion. Its problem is subtler: generic blue-gray tokens, repeated white cards, text-character icons, raw state names, and shallow hierarchy make it feel like a competent React Native starter rather than the mobile expression of Local Fitness Advisor.

**Deterministic scan:** 16 advisory findings, all `design-system-color`. Fifteen are in `apps/android-companion/src/PairScreen.tsx` and one is in `apps/android-companion/src/ui/theme.ts`. The scan confirms that pairing has a parallel hard-coded palette rather than even using the mobile theme. The `#000` camera-preview fallback is a likely anti-pattern false positive, although the remaining literals are still valid design-governance findings. The detector exited 1 despite its documentation saying findings exit 2.

**Visual overlays:** No reliable user-visible overlay is available. No Expo web target, connected Android device, emulator, or ADB runtime could be verified. The active port 5173 is the desktop Vite app, not the Android target. Mobile visual conclusions therefore use source and deterministic evidence; the desktop comparison was inspected separately in a fresh browser tab.

## Overall Impression

The native architecture is sensible and the app is calm, legible, and task-oriented. It does not yet feel like the same product as the PC app, and the gap is larger than color: status, freshness, provenance, measurement formatting, validation, and completion language have no shared presentation contract. The biggest opportunity is to build that contract once, then compose it differently for desktop and mobile.

## What’s Working

1. **Appropriate native structure.** Bottom tabs, native stack navigation, pull-to-refresh, camera, switch, date picker, safe areas, and modal pairing are the right mobile primitives.
2. **A sound reuse boundary already exists.** Shared summary/detail types, filtering, sorting, chart-domain calculation, and pagination merging prove that reuse does not require porting DOM components into React Native.
3. **Trust-aware pairing copy.** Local OCR, pinned connections, PC approval, denial, timeout, and revocation are explained more clearly than in many companion apps.

## Cognitive Load

**High: 4 of 8 checks fail.** Single focus, grouping, one-thing-at-a-time, and basic progressive disclosure pass. Chunking, visual hierarchy, minimal choices, and working-memory support fail.

- Health Connect presents 24 category choices plus five sync-window choices.
- Manual groups can add an unbounded chip list.
- Track can expose many metric categories without a higher-level overview.
- Pairing requires the user to remember a PC destination, approve there, and return to mobile.

## Emotional Journey

The assigned profile and local-first connection create a reassuring entry. Pairing then introduces a five-minute cross-device waiting valley with no elapsed time or expiry cue, followed by a clear success peak. Import creates a second trust valley by exposing technical codes and free-text units. The most damaging moment is an implausible reading displayed with the same authority as valid data; the live web comparison showed oxygen saturation as 9400% beside a 92–100% reference range, and mobile renderers have no quality-warning contract to prevent the same failure. Import success then ends weakly, without accepted, skipped, or questionable counts or a recommended next action.

## Priority Issues

### [P1] Missing shared health-presentation and quality contract

**Why it matters:** Raw or converted numbers are treated as authoritative. A physiologically impossible value can appear in cards and charts without quarantine or explanation, undermining trust in the entire record.

**Fix:** Add a shared presentation model with formatted value, display unit, quality state, provenance, observed/imported timestamps, range compatibility, and user-safe warning copy. Quarantine invalid readings before dashboard use and expose the same verdict on both platforms.

**Suggested command:** `$impeccable harden apps/android-companion`

### [P1] Import controls create preventable data errors

**Why it matters:** Free-text measurement codes, units, and values let users create syntactically valid but semantically incorrect health records.

**Fix:** Replace free text with searchable native selectors backed by shared measurement metadata, unit-aware defaults, numeric constraints, field-level errors, and a review summary for accepted, skipped, and questionable rows.

**Suggested command:** `$impeccable harden apps/android-companion/src/screens/ImportScreen.tsx`

### [P1] Accessibility semantics are incomplete

**Why it matters:** TalkBack users may not know which segment or chip is selected, when an asynchronous operation completes, or what a chart contains.

**Fix:** Add native roles and selected states, announcement semantics, accessible icon labels, chart summaries, a tabular trend alternative, and dynamic-type/touch-target verification.

**Suggested command:** `$impeccable audit apps/android-companion`

### [P2] Mobile does not carry the committed product identity

**Why it matters:** The web uses a deliberate indigo, lavender, seafoam, blush, layered-canvas, and semantic-state system. Mobile uses a generic blue-gray palette, while PairScreen duplicates another hard-coded palette. The companion reads as a separate utility.

**Fix:** Establish one platform-neutral semantic token source that emits CSS custom properties and React Native values. Share color roles, typography roles, radii, spacing, status semantics, and trust language, while keeping components platform-native.

**Suggested command:** `$impeccable document`

### [P2] Hierarchy and completion states are too shallow

**Why it matters:** Lifetime inventory counts, latest readings, connection health, warnings, and next actions receive nearly identical card weight. Users cannot scan what is fresh, what needs review, and what to do next.

**Fix:** Recompose the dashboard for mobile: profile and freshness header, review-needed state, latest readings, compact inventory disclosure, and one clear next action. Give import results distinct success/warning/error treatments and useful summaries.

**Suggested command:** `$impeccable shape mobile dashboard and import completion states`

## Cross-Platform Boundary

**Share:** semantic tokens; formatted-measurement and quality view models; unit policy; provenance and freshness; paging/filtering/conversion/validation behavior; connection-state and import-summary copy contracts; pluralization.

**Keep native:** React Navigation and bottom tabs; Pressable, TextInput, Switch, date picker, camera, permissions, safe areas, keyboard behavior, haptics; TalkBack APIs versus ARIA; mobile information composition. Recreate product meaning and tone, not desktop markup.

## Persona Red Flags

**Jordan, first-time user:** Jordan must discover “Import → Fitness Tracker” on the PC, approve there, return to mobile, and interpret terms such as pinned connection, OCR, profile assignment, and raw connection states. “Ask the user to approve” is awkward when Jordan is the user and adds uncertainty at the highest-friction step.

**Sam, TalkBack and larger-text user:** Segment and chip selection may not be announced, glyph tab icons have uncertain spoken labels, transient status changes may be silent, and trend charts have no navigable data. Source review cannot establish whether large text clips or pushes actions below the viewport.

**Casey, distracted mobile user:** Twenty-four category chips push sync controls far below the fold. Pairing and Health Connect lack a compact checkpoint such as “6 categories · last 30 days · syncing to Ben.” Interruption recovery is unclear.

## Minor Observations

- The `⌂`, `＋`, and `⌁` tab glyphs create an inconsistent icon vocabulary.
- The text-only Connection header action has no explicit minimum touch target.
- `connectionState.replaceAll("-", " ")` leaks internal state naming.
- “Online · refreshed just now” is asserted rather than tied to a refresh timestamp.
- `record(s)` needs real pluralization.
- The trend chart lacks axes, range controls, reference bands, selectable points, and quality warnings.
- `Screen` is only a padded `View`; scrolling, safe-area, and keyboard behavior remain screen-by-screen obligations.
- Uppercase “Assigned profile” repeats an eyebrow convention without adding useful hierarchy.

## Questions to Consider

1. Is the companion primarily a trustworthy sync instrument or a compact health-review app? Its navigation promises both, but its data semantics currently support the former better.
2. Should any physiologically impossible reading enter a trusted dashboard without an explicit quarantine state?
3. Would a recommended default such as “Steps, sleep, heart, and body data from the last 30 days” serve most users better than 29 visible configuration choices?
4. Should the first mobile viewport prioritize last sync, accepted records, records needing review, and PC reachability instead of lifetime inventory totals?
5. What must feel identical across platforms: formatted value, provenance, freshness, quality state, trust copy, and completion language?
