---
target: track calendar page
total_score: 33
p0_count: 0
p1_count: 2
timestamp: 2026-08-04T09-51-57Z
slug: apps-web-src-pages-calendarpage-tsx
---
# Track Calendar Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 4 | Clear selected-day state, loading state, retry actions, and live month announcement. |
| 2 | Match System / Real World | 3 | "Use for heatmap" is implementation-oriented rather than a user goal. |
| 3 | User Control and Freedom | 3 | Metrics can be added, removed, and promoted, but the inspector cannot be reduced or hidden. |
| 4 | Consistency and Standards | 4 | Strong semantic table, keyboard grid navigation, and familiar calendar behavior. |
| 5 | Error Prevention | 4 | The three-metric cap and explicit selected state constrain comparison safely. |
| 6 | Recognition Rather Than Recall | 3 | The legend and visible metric labels help, but aggregation and range require interpretation on each visit. |
| 7 | Flexibility and Efficiency | 3 | Keyboard navigation is excellent, but repeat reviewers cannot choose a compact detail density. |
| 8 | Aesthetic and Minimalist Design | 2 | Header controls receive the same solid accent as a primary command; inspector exposes all metadata at once. |
| 9 | Error Recovery | 4 | Retry paths are clear for both calendar and event requests. |
| 10 | Help and Documentation | 3 | Timezone is explicit, but aggregation and range are unexplained in the daily review context. |
| **Total** | | **33/40** | **Strong foundation; hierarchy needs refinement** |

## Anti-Patterns Verdict

**LLM assessment:** This does not read as AI-generated. The calendar has purposeful information design, a restrained heat scale, semantic structure, keyboard support, and a product-appropriate palette. The problem is inverted emphasis: controls that merely move the month visually compete with the data surface, while the selected-day inspector treats primary evidence and audit metadata as equally urgent.

**Deterministic scan:** The bundled scan completed with no findings for `apps/web/src/pages/CalendarPage.tsx`. Manual evidence review found no banned layout or decorative patterns. The calendar CSS does use hard-coded heat and metric colors rather than named semantic tokens; this is a maintainability concern, not an anti-pattern finding.

**Visual overlays:** No reliable overlay is available. A fresh browser tab at `http://127.0.0.1:5174/track/calendar` rendered blank with two 404 resource failures and no accessibility tree. Script injection could not be attempted reliably.

## Overall Impression

The calendar itself is the right centerpiece: it is compact, readable, and carries comparison well. The single biggest opportunity is to treat the right column as a selected-day summary, not a complete audit report. The top controls should support the grid rather than contend with it.

## What's Working

- The grid has a clear scan path: day number, value, comparison marks, and event count. The five-level heat map is legible without turning health values into clinical status colors.
- The interaction model is unusually solid: roving tab focus, arrow-key navigation, Home/End behavior, Enter/Space selection, full accessible day labels, and explicit loading/retry state in [CalendarPage.tsx](apps/web/src/pages/CalendarPage.tsx).
- The layout already does the right structural thing on small screens by stacking the inspector beneath the calendar in [styles.css](apps/web/src/styles.css).

## Priority Issues

### [P1] Month navigation is rendered as competing primary actions

**Why it matters:** The previous, next, and Today controls inherit the application-wide solid indigo button treatment. They form a high-contrast row at the top right even though they only change the calendar frame. That pulls attention away from the heatmap, the page's actual task surface, and conflicts with the design system's Accent Rarity Rule.

**Fix:** Give `.calendar-month-controls button` a local secondary treatment: surface background, quiet border, ink text, and a soft-surface hover. Keep the current 44px target and focus ring. The icon-only previous/next controls can be compact square buttons; Today should remain a labeled secondary action. Do not change the selected-day or active-route indigo semantics.

**Suggested command:** `$impeccable quieter`

### [P1] The inspector makes every kind of information equally immediate

**Why it matters:** For each selected metric, the inspector always shows measurement name, value, aggregation, daily range, and source, then renders completed events and all their provider/notes. With up to three metrics, one day click can expose 15 metadata rows before event text. That turns an ordinary review into an audit exercise and creates the noise you are seeing.

**Fix:** Make the default inspector a summary: date, selected metric value and unit, compact event count, then one concise line of secondary context. Put aggregation, range, sources, and full event details into labelled `details` disclosures. Keep the data in the DOM and preserve definition-list semantics for screen readers. Let the inspector scroll independently only if an expanded event list exceeds the viewport; do not make the basic view a fixed-height scrolling box.

**Suggested command:** `$impeccable distill`

### [P2] Heatmap-primary selection is phrased and placed as a secondary button inside every metric chip

**Why it matters:** `Use for heatmap` asks the user to make a visualization configuration decision while they are scanning measurements. It also creates another text button in the control area, adding to the top-of-page button density.

**Fix:** Reframe this as a selected-state control in the metric picker: a compact radio-style primary marker or an icon button with tooltip, labelled "Primary for heatmap". The primary metric is a state, not a command. The remove control should remain separate and icon-only with its accessible label.

**Suggested command:** `$impeccable clarify`

### [P2] Calendar-specific colors bypass the semantic token system

**Why it matters:** Metric keys, focus/selection colors, event text, and the heat scale are hard-coded in [styles.css](apps/web/src/styles.css). This weakens the shared visual contract and makes later theme or contrast tuning fragile.

**Fix:** Promote the three metric colors and five heat steps to scoped `--calendar-*` variables derived from the canonical token layer. Preserve their meaning; this is not a request to redesign the heatmap palette.

**Suggested command:** `$impeccable harden`

## Persona Red Flags

**Jordan, first-time reviewer:** Clicking a day creates a long label-value wall before explaining which value matters most. Jordan can recognize the calendar but cannot immediately answer the main question: what happened on this day?

**Alex, repeat reviewer:** Alex has high-efficiency keyboard navigation through the grid, but every selection still forces the same dense inspector. Alex cannot keep a trend-reading mode while retaining the ability to expand evidence only when needed.

**Low-vision reviewer:** The grid is accessible by label and keyboard, but the 0.45rem comparison dots and 0.72rem event count are visually secondary enough that they should never be the only indication of a comparison or event. The existing accessible day label covers non-visual use; the visual design should retain an unambiguous selected-day summary.

## Minor Observations

- Keep the timezone line, but move it into a compact selected-day metadata line or disclosure; it is useful context but not the selected day's primary fact.
- `Completed health events (n)` repeats the count already carried by the event marker. A summary disclosure can make that count do useful work instead.
- Replace the text glyphs for previous/next with the existing Lucide icon vocabulary if it is already available in this surface, retaining accessible labels.
- The browser render failure is not a visual defect finding, but it blocks screenshot-based validation. Resolve its 404 resources before the implementation review.

## Questions to Consider

- Should the first click on a date answer "what was recorded?" while the second, optional action answers "where did it come from and how was it aggregated?"
- Are event notes a day-summary concern, or should they appear only when the user explicitly opens the completed-events disclosure?
- Would a reviewer ever need more than one expanded metric at a time?
