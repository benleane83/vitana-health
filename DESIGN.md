---
name: "Local Fitness Advisor"
description: "A light, private, trust-first health workspace inspired by the Vitara visual direction."
colors:
  canvas: "oklch(97% 0.008 255)"
  canvas-alt: "oklch(95% 0.012 262)"
  surface: "oklch(99% 0.004 260)"
  surface-soft: "oklch(96% 0.012 254)"
  text: "oklch(30% 0.07 275)"
  text-muted: "oklch(48% 0.04 272)"
  line: "oklch(86% 0.02 260)"
  primary: "oklch(46% 0.13 278)"
  primary-strong: "oklch(40% 0.15 278)"
  lavender: "oklch(72% 0.1 300)"
  lavender-soft: "oklch(95% 0.026 300)"
  seafoam: "oklch(79% 0.08 190)"
  seafoam-strong: "oklch(39% 0.085 195)"
  seafoam-soft: "oklch(95% 0.035 190)"
  blush: "oklch(80% 0.09 355)"
  blush-strong: "oklch(42% 0.1 344)"
  blush-soft: "oklch(96% 0.035 344)"
  success: "oklch(66% 0.12 170)"
  success-strong: "oklch(39% 0.095 170)"
  success-soft: "oklch(94% 0.04 170)"
  warning: "oklch(78% 0.13 82)"
  warning-strong: "oklch(44% 0.105 76)"
  warning-soft: "oklch(95% 0.04 82)"
  danger: "oklch(64% 0.19 28)"
  focus: "oklch(72% 0.12 245)"
  ink-on-primary: "oklch(99% 0.004 260)"
typography:
  display:
    fontFamily: "Aptos Display, Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  pill: "999px"
  input: "12px"
  item: "12px"
  panel: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-on-primary}"
    rounded: "{rounded.pill}"
    padding: "0.65rem 1rem"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    padding: "0.7rem 0.85rem"
---

# Design System: Local Fitness Advisor (Vitara-aligned)

## 1. Overview

Creative North Star: "Track, Understand, Thrive - in a private, trusted workspace."

This redesign shifts the app from dark botanical dashboards to a light, calming, clinically-neutral product surface inspired by the attached Vitara style guide. The app should feel welcoming and emotionally safe while staying evidence-first and data-literate.

Design serves product tasks first: import review, summary analysis, biological age interpretation, and AI-assisted questioning. Visual polish supports confidence and comprehension, not decoration.

### Product tone
- Calm and reassuring, never alarmist.
- Modern and friendly, never childish or gamified.
- Private and credible, never clinical or hospital-like.
- Soft gradients and iconography are allowed in identity moments, but core workflows stay structured and readable.

### Core visual commitments
- Light-mode default with high-contrast text.
- Indigo-led action color system with lavender, seafoam, and blush accents.
- Medium-radius surfaces (12 to 16px), not oversized rounded cards.
- Unified sans-serif typography for controls, data, and prose.
- Motion is minimal and state-based (feedback, loading, focus), not cinematic.

## 2. Color System

Use OKLCH tokens in implementation; hex values below are style-guide anchors for design reviews.

### Brand anchors (reference)
- Deep Navy: #1B1D3A
- Indigo Blue: #2D3A8C
- Soft Lavender: #887CF6
- Seafoam: #4ECDBA
- Blush Pink: #FFB3C1

### Gradients
- Calm and Trust: Lavender -> Indigo -> Seafoam
- Energy and Vitality: Blush -> Warm Peach -> Light Gold

### Semantic roles
- Primary action: `primary`
- Hover/pressed action: `primary-strong`
- Informational highlight: `seafoam`
- Supportive accent: `lavender`
- Positive status: `success`
- Warning: `warning`
- Error/destructive: `danger`

### Neutral roles
- App canvas: `canvas`
- Secondary canvas (section transitions): `canvas-alt`
- Content surface: `surface`
- Alternate surface: `surface-soft`
- Borders/dividers: `line`
- Primary text: `text`
- Secondary text: `text-muted`

### Usage rules
- Keep accents rare and meaningful: action, selected state, data status.
- Never use pastel accents for body text.
- Body text and placeholder text must meet WCAG AA contrast against their background.
- Do not tint all surfaces differently; use one primary surface and one alternate surface.

## 3. Typography

Single-family product typography to preserve consistency and speed of scanning.

### Font stack
- Primary: Aptos / Segoe UI / system sans-serif
- Display moments: Aptos Display (same family lineage), used sparingly

### Scale
- h1: 2.25rem max on app pages (no oversized hero text in task views)
- h2: 1.5rem
- h3: 1.125rem
- body: 1rem
- label/meta: 0.875 to 0.9rem

### Rules
- Use `text-wrap: balance` on h1-h3.
- Keep line length near 65-75ch for explanatory prose.
- No display serif in controls, tables, labels, or forms.
- Do not exceed letter-spacing of -0.04em; default heading target is -0.02em.

## 4. Layout and Structure

### Grid and spacing
- Use a 12-column responsive grid at page level where needed.
- For repeatable card groups, default to `repeat(auto-fit, minmax(280px, 1fr))`.
- Spacing rhythm: 4, 8, 12, 16, 24, 32.

### Density strategy
- Dashboard and summary may be medium density.
- Import and settings forms should remain relaxed and instructional.
- Tables and metric rows prioritize scan order: label -> value -> unit -> status -> recency.

### Responsive behavior
- Navigation collapses cleanly on narrow widths.
- Metrics and stat blocks stack without truncating labels.
- No heading overflow at tablet/mobile widths.

## 5. Component Standards

All interactive components must support: default, hover, focus-visible, active, disabled, and error where relevant.

### Navigation
- Top tabs remain for route switching.
- Active tab uses primary color fill and strong contrast text.
- Inactive tabs use surface styles with clear hover/focus feedback.

### Panels
- Default panel: `surface`, 1px `line` border, radius 16px.
- Avoid nested panel-in-panel patterns unless hierarchy demands it.
- Shadow is subtle and optional; border + tone separation is primary.

### Buttons
- Primary: indigo solid or restrained brand gradient.
- Secondary: outlined with neutral border.
- Destructive: danger-tinted, never blended with primary.
- No oversized glows or decorative shadows.

### Inputs and forms
- Input radius 12px, clear label above field.
- Placeholder contrast meets WCAG AA.
- Validation messaging appears below fields with semantic color + text.
- Settings and import flows include inline guidance, not modal-only help.

### Data rows and tables
- Status always includes text; color is supplemental.
- Unit formatting is consistent and explicit.
- Use subtle zebra/section separation only when it improves scan speed.

### Empty/loading/error states
- Empty states explain what to do next.
- Prefer skeleton blocks for data-loading regions.
- Keep error copy actionable and non-alarmist.

## 6. Motion and Interaction

### Timing and easing
- Standard transitions: 150 to 220ms.
- Use ease-out curves for hover/focus transitions.

### Allowed motion
- Hover state transitions.
- Focus ring transitions.
- Loading skeleton shimmer at low contrast.
- Small chart/metric transitions when values update.

### Restricted motion
- No page-load choreography.
- No decorative floating elements in task surfaces.
- No animations that hide essential content by default.

### Accessibility
- Respect `prefers-reduced-motion: reduce` with instant transitions or cross-fades.
- Keep keyboard focus always visible.

## 7. Route-level Direction

### Dashboard
- Welcome and trust framing at top.
- Quick scan cards for imports, trends, and alerts.
- Privacy statement remains visible but lightweight.

### Biological Age
- Clear deterministic model framing.
- Methodology, inputs, and limitations presented with hierarchy.
- Emphasis on readability over visual flair.

### Import
- Guided flow with clear source selection.
- File status and parse outcomes are explicit and legible.
- Inline correction paths for incomplete data.

### Health Data Summary
- High-density, sortable, filterable metrics.
- Trend and range interpretation should remain concise.

### AI Query
- Distinguish deterministic plan/SQL/result from AI narrative.
- Safety and consent status should be visible before submit.

### Settings
- Configuration first, integrations second.
- Validation outcomes appear in-context with precise feedback.

## 8. Dos and Donts

### Do
- Keep privacy and data provenance visible near key interactions.
- Use pastel accents as support, not as text colors.
- Standardize component states across all routes.
- Keep tone reassuring and specific.

### Do not
- Reintroduce dark heavy glass surfaces as default.
- Use gradient text, side-stripe card accents, or decorative grid overlays.
- Over-round cards beyond 16px.
- Depend on color alone to communicate health status.
- Use medical-diagnosis language or urgent treatment cues.

## 9. Implementation notes

- Migrate tokens in `apps/web/src/styles.css` to this palette and radius scale first.
- Then normalize component states route by route (nav, buttons, inputs, table rows).
- Keep app semantics and safety copy intact while updating visuals.
- Validate contrast and keyboard flows before shipping each redesigned route.
