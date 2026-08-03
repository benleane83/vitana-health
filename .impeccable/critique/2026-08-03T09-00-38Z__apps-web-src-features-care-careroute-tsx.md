---
target: critique my Care page
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-08-03T09-00-38Z
slug: apps-web-src-features-care-careroute-tsx
---
# Care Page Design Critique

Method: dual-agent (A: Explore design review · B: Explore detector/browser evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Loading and notice states exist, but list totals and active-filter state are absent. |
| 2 | Match System / Real World | 3 | Planned care and historical events use clear language, but their relationship is under-explained. |
| 3 | User Control and Freedom | 3 | Cancel and delete confirmation are present; no undo exists. |
| 4 | Consistency and Standards | 3 | Controls match the app, but “Select a record” does not match non-selectable rows. |
| 5 | Error Prevention | 2 | Destructive confirmation is solid; forms provide little inline prevention or guidance. |
| 6 | Recognition Rather Than Recall | 2 | Users must discover row editing through the ellipsis and remember filter state. |
| 7 | Flexibility and Efficiency | 2 | Core CRUD works, but filters require Apply and mobile editing incurs a long scroll. |
| 8 | Aesthetic and Minimalist Design | 3 | Calm and restrained, though filters dominate the content area. |
| 9 | Error Recovery | 2 | Errors are announced, but recovery guidance and undo are limited. |
| 10 | Help and Documentation | 2 | View descriptions exist; completion semantics and reminder behavior remain unclear. |
| **Total** | | **25/40** | **Usable, with meaningful workflow friction** |

## Anti-Patterns Verdict

**LLM assessment:** The page does not look AI-generated. It follows the app’s restrained product vocabulary, uses one coherent font, avoids decorative gradients and nested cards, and feels calm enough for personal health data. Its weakness is not visual gimmickry but generic CRUD composition: a large filter stack, repeated bordered rows, and a passive right pane do not create a strong task hierarchy.

**Deterministic scan:** The CLI detector returned zero findings for `apps/web/src/features/care/CareRoute.tsx`. The live detector reported long source lines, a single Aptos family, and a `transition: width`. These are false positives for this surface: one UI family is appropriate in the product register; the long-line flag concerns compressed JSX rather than rendered copy; and the width transition belongs to `.query-bar-fill`, outside Care.

**Visual overlays:** Injection succeeded in a fresh browser tab and rendered three overlay elements. No overlay remains open; the tab and temporary server were closed after evidence capture.

## Overall Impression

The Care page is trustworthy and functionally complete, but it behaves more like an admin CRUD screen than a care-planning workspace. The largest opportunity is to make the current task unmistakable: find what needs attention, act on it, and see the editor immediately.

## What’s Working

1. **Calm product tone:** cool surfaces, restrained semantic color, and compact typography fit a private health tool without resembling a hospital portal.
2. **Solid semantic foundation:** tabs, tabpanel relationships, live regions, labelled fields, keyboard tab switching, and destructive confirmation are thoughtfully implemented.
3. **Useful workflow model:** separating future-facing Care items from past-facing Health events is sound, and completion creates a linked historical event rather than losing context.

## Priority Issues

### [P1] Filters consume the page before records do

**Why it matters:** At 1440px, four filter controls occupy 212px vertically inside a 731px list column. With no matches, the filters are the dominant experience. Users come here to see care, not configure a query form.

**Fix:** Make filters a compact desktop toolbar, auto-apply selects, debounce search, show active-filter count and a clear action, and collapse advanced filters on mobile. Preserve the default Open status as an explicit chip or label.

**Suggested command:** `$impeccable layout`

### [P1] Mobile Add/Edit opens almost off-screen

**Why it matters:** At 390×844, the editor begins at y=784 after Add care item. With records present it can be much farther below the trigger, so the interface appears not to respond.

**Fix:** On mobile, move the editor before the list while active, scroll and focus its heading after opening, or use a full-width routed editor. Keep the desktop side pane.

**Suggested command:** `$impeccable adapt`

### [P1] Record selection guidance contradicts the interaction

**Why it matters:** The right pane says “Select a record to edit it,” but `.care-row` is a non-interactive article. Editing is hidden under the ellipsis, creating a recognition failure at the central workflow.

**Fix:** Make the row title/body an accessible selection button that opens the editor, or expose Edit directly on desktop and rewrite the empty-pane instruction to match. Keep Delete secondary.

**Suggested command:** `$impeccable clarify`

### [P2] Empty state is fragmented and passive

**Why it matters:** An empty list shows “No care items matched these filters” while the adjacent pane simultaneously says “Select a record… or add a new one.” Two weak messages compete, even when there are no records to select.

**Fix:** Distinguish “no records yet” from “filters found no matches.” Use one contextual empty state with Add care item or Clear filters as the primary action; hide the idle editor pane on mobile.

**Suggested command:** `$impeccable onboard`

### [P2] Planned-care completion is under-explained

**Why it matters:** Users must infer that completing a Care item creates a linked Health event. The completion form then asks for Kind again despite having a computed default, which makes the transition feel uncertain.

**Fix:** Explain the model near the tabs and in the completion editor: “Completing this records a Health event.” Present the mapped kind as a summary with an optional Change action rather than a required-looking choice.

**Suggested command:** `$impeccable clarify`

## Persona Red Flags

**Jordan, first-time user:** Opens an empty Care items view and sees search, two selects, Apply, and two empty messages before learning what a Care item is. Likely to hesitate between Add care item and Health events.

**Sam, busy caregiver:** Needs to scan overdue household care quickly, but filter controls dominate, due dates are secondary text, and there is no visible count or urgency grouping. Repeated profile switching increases context loss.

**Alex, keyboard/power user:** Can switch tabs with arrows, but cannot select a row directly, trigger the primary row workflow efficiently, or see active filters without inspecting every control.

## Minor Observations

- Show result totals and remaining count beside Load more.
- Clarify whether reminder dates produce notifications or are only stored locally.
- Give overdue dates and priority stronger scan weight than status/kind metadata.
- Preserve the 44px menu target, but make the action icon more familiar than a text ellipsis if the existing icon library supports it.
- The 900px one-column breakpoint is structurally correct; the active editor ordering is the actual mobile problem.

## Questions to Consider

1. Is Care primarily a daily action queue, a complete record manager, or both? The current page gives both equal weight.
2. Should clicking a care row open it, or is edit intentionally restricted to the action menu?
3. When completing an item, how often is the mapped Health event kind genuinely wrong? That answer determines whether Change kind should be prominent or progressive.
