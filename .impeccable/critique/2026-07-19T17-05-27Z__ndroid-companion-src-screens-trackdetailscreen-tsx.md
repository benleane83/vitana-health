---
target: mobile app measurement detail page
total_score: 26
p0_count: 0
p1_count: 3
timestamp: 2026-07-19T17-05-27Z
slug: ndroid-companion-src-screens-trackdetailscreen-tsx
---
# Measurement Detail Page Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Save/delete feedback appears after the history list rather than beside the mutation. |
| 2 | Match System / Real World | 3 | Health vocabulary is clear, but the edit form exposes an ISO timestamp. |
| 3 | User Control and Freedom | 3 | Edit can be cancelled and delete is confirmed; there is no post-delete undo. |
| 4 | Consistency and Standards | 3 | Existing cards, headings, statuses, and action controls are consistent. |
| 5 | Error Prevention | 2 | Free-text date/time input invites format and timezone errors. |
| 6 | Recognition Rather Than Recall | 3 | Current value, time, source, range, and history are available together, but range lines lack a legend. |
| 7 | Flexibility and Efficiency | 2 | The repeated record task is slowed by two full actions per row and raw timestamp entry. |
| 8 | Aesthetic and Minimalist Design | 3 | Calm and evidence-led, but history becomes a tall set of visually similar cards. |
| 9 | Error Recovery | 2 | Validation feedback exists but has no field-level recovery; deletion cannot be reversed. |
| 10 | Help and Documentation | 2 | Range origin and source are clear; chart/range meaning needs concise explanation. |
| **Total** | | **26/40** | **Usable foundation; priority work needed for evidence clarity and maintenance efficiency.** |

## Anti-Patterns Verdict

**LLM assessment:** This does not look AI-generated. The surface is specific to personal health review: source, time, units, range origin, and data state are all retained. The risk is density and equal visual weight, not generic visual styling.

**Deterministic scan:** The scoped CLI scan returned zero findings for `apps/android-companion/src/screens/TrackDetailScreen.tsx`. Browser overlay injection succeeded. It displayed one runtime `layout property animation: transition: padding` finding, but no matching transition exists in the target source; treat it as a shared/framework false positive for this scope.

## Overall Impression

The top of the screen gives a calm, credible snapshot: metric identity, latest evidence, range context, and trend appear in a sensible order. The experience becomes operational in History, where a scan-heavy evidence list is implemented as repeated cards with permanently exposed text actions. The largest opportunity is to connect the reference range visibly to the trend/status decision and make record maintenance a focused secondary state.

## What's Working

- Current value, observed time, source, unit, and status make provenance unusually visible for a mobile health screen.
- The order of latest evidence, reference context, trend, and history matches how a repeat reviewer builds understanding.
- Status chips include text and do not overstate clinical meaning through alarmist color treatment.

## Priority Issues

### P1 - Reference context is fragmented

**Why it matters:** The range card, status chip, and dashed trend lines may describe the same rule, but the user must infer the relationship. That weakens the app's evidence-first trust model.

**Fix:** Add a compact trend legend such as `Reference range: 60-80 kg, personal range`; state that statuses compare readings with this range; add neutral wording that ranges are context, not a diagnosis.

**Suggested command:** `$impeccable clarify`

### P1 - Raw date/time entry risks record integrity

**Why it matters:** Health-record timestamps are evidence. Entering a raw ISO string on a phone is error-prone and makes timezone/precision changes difficult to recognize.

**Fix:** Replace it with native date and time pickers, show the selected value in the user's locale, retain the stored instant internally, and show field-level validation beneath the control.

**Suggested command:** `$impeccable harden`

### P1 - Deletion is not recoverable

**Why it matters:** Similar readings make an accidental deletion plausible. A confirmation protects only before the action and the current screen refresh makes recovery impossible.

**Fix:** After deletion, show a short-lived, screen-local confirmation with `Undo`; defer permanent removal until that undo window ends.

**Suggested command:** `$impeccable harden`

### P2 - History is too card- and action-heavy

**Why it matters:** Seven entries already create a long repetitive feed. Two full-width text commands on every record compete with quick evidence review and get worse with a large history.

**Fix:** Use denser record rows for value, time, source, and status. Put maintenance actions in a labelled overflow action or select one record before exposing the edit surface. Preserve the full editor only for the active record.

**Suggested command:** `$impeccable layout`

### P2 - Mutation feedback is distant

**Why it matters:** Success/failure feedback after all history rows can be below the user's viewport, leaving them unsure whether their edit or delete succeeded.

**Fix:** Place success feedback next to the changed row or show an accessible toast/banner near the top of the scroll view; announce the updated value after saving.

**Suggested command:** `$impeccable polish`

### P2 - Demo-mode copy contradicts temporary edit behavior

**Why it matters:** Connection settings still says `Explore read-only sample health data without a PC` while editable demo observations now support transient edits. That makes the capability feel unreliable.

**Fix:** Change it to explain that editable sample observations reset after the app reloads; retain the import-specific read-only guidance where appropriate.

**Suggested command:** `$impeccable clarify`

## Persona Red Flags

**Repeat reviewer:** Permanently visible Edit/Delete controls and repeated cards slow scanning for source/time differences. The reviewer must ignore two maintenance actions on every row.

**First-time reviewer:** `Reference range`, a status label, and dashed chart lines can imply medical certainty. The relationship between them and the non-diagnostic nature of the range is not stated.

**Mobile/accessibility user:** The ISO date entry is poorly suited to a touch keyboard. The chart's selectable points have accessible labels but no visible cue that they are interactive. Large text can also force the latest value to auto-shrink.

## Minor Observations

- The selected chart value and live-region announcement are a strong accessibility base; add a visible interaction cue for selecting a point.
- Notes use muted metadata styling and may be too visually subordinate when they contain meaningful personal context.
- The `Latest` text uses one-line auto-sizing, which preserves layout at the risk of smaller type with long formatted values.
- The web demo was observed at 1280px and a 390px narrow viewport; edit mode expands inline into four fields and two commands.

## Questions to Consider

1. Is the primary job on this page evidence review or record maintenance, and should editing be an explicit secondary mode?
2. Would a user understand what a status means without assuming the app is making a medical judgment?
3. Can a reviewer distinguish two readings with the same value but different source, time, or note in three seconds?
