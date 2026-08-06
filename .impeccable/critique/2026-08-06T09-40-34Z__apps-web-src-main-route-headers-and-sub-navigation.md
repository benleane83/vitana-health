---
target: critique my desktop app top navigation and page headers
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-08-06T09-40-34Z
slug: apps-web-src-main-route-headers-and-sub-navigation
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Active top-level and local tabs are clear, but equivalent routes use different visual hierarchies. |
| 2 | Match System / Real World | 3/4 | Labels fit health workflows; Care's bounded-tool appearance implies a distinction the product model does not support. |
| 3 | User Control and Freedom | 3/4 | Routes and tabs are freely navigable with solid keyboard support. |
| 4 | Consistency and Standards | 2/4 | Three shell models coexist: open sidebar workspaces, Care's all-in-one panel, and Track's tabs-above-panel model. |
| 5 | Error Prevention | 3/4 | Existing controls and confirmation patterns are sound; this critique found no header-specific prevention defect. |
| 6 | Recognition Rather Than Recall | 2/4 | Users must relearn where the title, description, local navigation, and content boundary appear. |
| 7 | Flexibility and Efficiency | 3/4 | Roving tab focus and arrow/Home/End support are strong; deep Track views could retain location more clearly. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Calm, restrained styling works, but Care's extra shell boundary and Track's internal variants weaken rhythm. |
| 9 | Error Recovery | 2/4 | Existing notices help, but recovery is not consistently tied to route-level state; mostly outside this critique's scope. |
| 10 | Help and Documentation | 2/4 | Descriptions help, but Care Items versus Health Events and deep Track context need clearer persistent orientation. |
| **Total** | | **26/40** | **Sound foundation, material consistency debt** |

## Anti-Patterns Verdict

**LLM assessment**: This does not look AI-generated. It is a restrained, domain-appropriate product UI with good semantic engineering. The visible problem is organic design drift: equivalent routes were built with locally sensible patterns but without a shared route-shell contract.

**Deterministic scan**: The CLI found 70 items in `apps/web/src`: 68 advisories and 2 warnings. Rules were 65 `design-system-color`, 3 `design-system-radius`, 1 `design-system-font`, and 1 `layout-transition`, all in `styles.css`. None directly identified route-header inconsistency, so these findings are background design-system debt rather than evidence for this critique. Many color findings are likely intentional data-visualization or semantic-state colors and need a separate token audit.

**Visual overlays**: Mutable injection succeeded on six representative routes. The browser detector reported Import 1, Track 1, Care 3, Insights 2, Export 4, and Settings 1 anti-patterns. On Care, the visible overlay identified two long-line instances and one `transition: width` layout animation. A `[Human] Vitana route-header critique` tab remains available with the Care overlay; the helper server was stopped after injection.

## Overall Impression

The top app navigation is already coherent and accessible. The largest opportunity is one layer below it: standardize where a route announces itself and where local navigation begins. Preserve variation inside each task workspace, but stop varying the route hierarchy itself.

## What's Working

1. **Top-level navigation is a strong shared anchor.** It is centralized in `App.tsx`, exposes clear selected state, and implements roving focus plus arrow/Home/End navigation.
2. **Four routes already form a useful family.** Import, Insights, Export, and Settings use open route headers followed by local-navigation workspaces, giving the redesign an existing pattern rather than requiring a new system.
3. **The visual language fits Vitana.** Restrained color, compact typography, bordered work surfaces, and direct copy feel calm and data-literate rather than promotional.

## Priority Issues

### [P1] Equivalent routes do not share a route-shell hierarchy

**What**: Import, Insights, Export, and Settings place H1s in open page shells. Care places its H1, description, tabs, and task content inside one white bordered panel. Track places local tabs above a separate bordered panel whose H1 is inside the panel.

**Why it matters**: The boundary changes what users think they are looking at. Care reads as an embedded tool, while Track reads as a tab strip controlling a card. Neither distinction reflects a meaningful change in route level.

**Browser evidence**: At 1364px, Care's `.panel.care-panel` begins at y=106 and contains its H1 at y=127; Track's tabs begin at y=106 and its `.panel.summary-panel` H1 starts at y=190. Import, Insights, Export, and Settings put open-shell H1s at y=106-118 with no enclosing panel.

**Fix**: Introduce a shared route shell with slots for H1, short description, optional primary action, and local navigation. Move Care's title and route description outside the white task surface. Move Track's route identity above the subview content panel.

**Suggested command**: `$impeccable shape`

### [P1] Track changes header grammar within one route

**What**: Measurements uses a bounded summary panel, while Journal, Calendar, and Body Trend use their own header/control compositions.

**Why it matters**: These are peers under the same four-option Track navigation. Switching views should change the work, not force users to reacquire the page structure.

**Fix**: Give Track one persistent route header and one persistent subview navigation. Let each subview own only its secondary heading, filters, date controls, charts, and content.

**Suggested command**: `$impeccable distill`

### [P2] Local navigation needs a documented placement rule, not one forced orientation

**What**: Import, Insights, Export, and Settings use left-side navigation; Care uses two horizontal tabs; Track uses four horizontal tabs. Some visually vertical tablists declare `aria-orientation="vertical"`, while others leave orientation unspecified.

**Why it matters**: Orientation can legitimately differ by option count and task shape, but placement and semantics should remain predictable. Forcing every route into a sidebar would replace drift with rigidity.

**Fix**: Keep horizontal tabs for compact two-to-four-option peers when useful and sidebars for tool families, but place both in the same route-shell navigation slot. Ensure `aria-orientation` matches the rendered layout at each breakpoint.

**Suggested command**: `$impeccable layout`

### [P2] Header copy and responsive behavior vary without a clear rule

**What**: Import and Export place descriptions beside the H1 at wide desktop, then below it at 900px. Settings keeps its description below. Insights' route-level and selected-tool descriptions are visually separated. Care has both a route description and a view description inside its panel.

**Why it matters**: Descriptions shift between route context and selected-view guidance, making hierarchy less scannable. The 900px reflow does not resolve the deeper inconsistency.

**Fix**: Keep one short route description directly under every H1. Put selected-view guidance next to the subview heading inside the workspace. Use the header's right slot for actions, not explanatory prose.

**Suggested command**: `$impeccable clarify`

## Persona Red Flags

**Returning chronic-condition user**: Frequently switching Track views changes the title/content boundary after every tab selection. Measurements looks like a complete panel while Journal, Calendar, and Body Trend feel like different page templates, weakening muscle memory.

**Family caregiver**: Moving between profiles and Care needs strong orientation. Care's enclosing panel suggests it has a different navigation level, while the distinction between Care Items and Health Events is explained only after entering that unique shell.

**Keyboard-oriented power user**: Top-level and local tab semantics are strong, but visual orientation and declared ARIA orientation are not fully aligned. Insights appears vertical without declaring vertical orientation; Care and Track rely on default horizontal behavior. Breakpoint changes should preserve an intelligible focus model.

## Minor Observations

- Settings sits outside the six-item main tablist as an icon button. That is defensible for application-level configuration and should stay distinct.
- Care's horizontal two-tab switch is not inherently wrong. Its placement inside the all-enclosing panel is the problem.
- At 900px, Import and Export local navigation become wide horizontal rows while retaining `aria-orientation="vertical"`; this deserves an accessibility pass when the shell is standardized.
- The CLI's broad palette warnings should be handled separately; combining them with this layout cleanup would inflate scope.
- No evidence supports treating the Care inconsistency as a P0 launch blocker. It is important P1 design debt.

## Questions to Consider

- Should every route expose the same H1, route description, action, and local-navigation slots even when the workspace beneath them is radically different?
- Is Track one route with four tools, or four pages sharing a top tab bar? The shell should encode that product decision consistently.
- Should two-option local navigation remain horizontal while three-or-more tool families use a sidebar, or should task shape rather than option count decide?
- Is Care's white workspace surface useful for its list/editor workflow once its route title and navigation move outside it?
