---
name: "Local Fitness Advisor"
description: "A calm local-first health data management and insight interface."
colors:
  vault-bg: "#09110d"
  ink: "#f4f1df"
  muted: "#a8b4a1"
  line: "#dcebb829"
  panel: "#0d1e17c7"
  panel-bright: "#1e4131db"
  leaf: "#b5f45d"
  amber: "#ffc857"
  coral: "#ff6b4a"
  cyan: "#85ffe1"
  ink-strong: "#071008"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.6rem"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "Alegreya Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Alegreya Sans, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  pill: "999px"
  input: "18px"
  item: "22px"
  panel: "34px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.pill}"
    padding: "0.78rem 1.1rem"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  input:
    backgroundColor: "{colors.vault-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "0.78rem 0.9rem"
---

# Design System: Local Fitness Advisor

## 1. Overview

**Creative North Star: "Local Health Data Management and Insights"**

This baseline captures the current app as a dark, local-first health dashboard built around personal data review, private imports, lab entry, and guarded AI query workflows. The system should feel calm, trustworthy, flexible, and data-literate: closer to a private evidence workspace than a medical portal or wellness game.

The current visual direction uses organic dark surfaces, high-contrast cream text, Fraunces display headings, Alegreya Sans UI text, and bright leaf/cyan accents. Future work can change any of these choices. Preserve the useful intent: privacy, legibility, and evidence-first review. Improve the weak spots: oversized hero typography, over-rounded panels, decorative glass treatment, and inconsistent query-screen tokens.

**Key Characteristics:**
- Local-first and privacy-forward without alarmist copy.
- Dense enough for repeated review, but not visually noisy.
- Data and units remain readable before decoration.
- AI output is visually distinct from deterministic observations.
- Health-state color must always be backed by text labels.

## 2. Colors

The baseline palette is a dark botanical-neutral scheme with leaf and cyan accents. It supports the current privacy cockpit mood, but future redesign work should feel free to refine the palette toward a quieter, more professional product surface.

### Primary
- **Leaf Signal** (#b5f45d): Primary action color and selected-state accent. Use sparingly for the next meaningful action, active route, or confirmed positive state.

### Secondary
- **Fresh Cyan** (#85ffe1): Secondary accent for data freshness, local/private cues, and low-status measurements. Avoid using it as generic decoration.
- **Warm Amber** (#ffc857): Warning or review-needed state. Pair with explicit text because color alone is not enough.

### Tertiary
- **Coral Alert** (#ff6b4a): Reserved for destructive, critical, or exception states if those states are added later. It is currently a token more than an established component color.

### Neutral
- **Vault Background** (#09110d): App background and dark input base.
- **Warm Ink** (#f4f1df): Primary text on dark surfaces.
- **Muted Moss** (#a8b4a1): Secondary text. Must be checked for contrast when placed on tinted panels.
- **Panel Green** (#0d1e17c7): Primary panel surface.
- **Bright Panel Green** (#1e4131db): Elevated or highlighted panel surface.
- **Soft Divider** (#dcebb829): Borders and separators.
- **Deep Ink** (#071008): Text on bright accent buttons.

### Named Rules
**The Accent Rarity Rule.** Leaf and cyan should identify action, selection, data freshness, or status. If the whole screen glows, nothing is important.

## 3. Typography

**Display Font:** Fraunces (with Georgia, serif fallback)  
**Body Font:** Alegreya Sans (with sans-serif fallback)  
**Label/Mono Font:** Alegreya Sans for labels; system monospace only for raw CSV or code-like content.

**Character:** The current type pairing gives the app a warmer, more personal voice than a typical SaaS dashboard. Keep that warmth only where it supports trust; dense controls and data rows should remain simple and highly legible.

### Hierarchy
- **Display** (900, currently `clamp(3.6rem, 8vw, 8.8rem)`, tight line-height): Used only on the dashboard hero. Future work should cap this lower and keep letter-spacing no tighter than `-0.04em`.
- **Headline** (700, `1.6rem`, compact line-height): Panel and page section headings.
- **Title** (700-900, `1.1rem` to `1.35rem`): Card titles, insight headings, and metric labels.
- **Body** (400-500, `1rem`, `1.45`): Explanatory copy, safety notes, summaries, and form helper text. Keep prose near 65-75ch where possible.
- **Label** (700-900, compact): Form labels, route labels, segmented controls, and table headers.

### Named Rules
**The Review-First Type Rule.** Product screens should use stable rem sizes. Save expressive type for page identity, not data rows, labels, or buttons.

## 4. Elevation

The current system uses a hybrid of tonal layering, blurred translucent panels, and large ambient shadows. That creates atmosphere, but it is heavier than a health-data management tool needs. Future components should be layered but restrained: use surface tone and borders first, then small shadows only when they clarify interaction or hierarchy.

### Shadow Vocabulary
- **Ambient Panel** (`box-shadow: 0 24px 80px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.06)`): Current high-drama panel treatment. Treat as legacy baseline; avoid expanding it.
- **Accent Hover** (`box-shadow: 0 14px 40px rgba(181, 244, 93, 0.18)`): Current button hover glow. Use only for primary actions and consider reducing blur in production polish.

### Named Rules
**The Layer Before Glow Rule.** Inactive panels should separate with tone, spacing, and border. Glow belongs to focused or selected state, not every surface.

## 5. Components

### Buttons
- **Shape:** Pill buttons (`999px`) are established for route navigation, actions, and segmented controls.
- **Primary:** Leaf-to-green gradient with Deep Ink text and bold weight. It should represent the main action in the current context.
- **Hover / Focus:** Current hover lifts by 2px with a soft accent shadow. Add explicit `focus-visible` rings during polish.
- **Secondary / Ghost:** Transparent background with Soft Divider border and Muted Moss text. Active state uses the primary accent treatment.

### Chips
- **Style:** Query examples currently behave like chips, but use undefined `--surface`, `--border`, and `--text` tokens. Normalize these to the shared palette during redesign.
- **State:** Chips should be buttons with visible hover, focus, and selected/pressed feedback if they mutate the query.

### Cards / Containers
- **Corner Style:** Current panels use large radii (`34px` to `36px`), while data items use `22px`. Future product surfaces should generally reduce panel radius to improve density.
- **Background:** Panel Green over Vault Background, with Soft Divider borders.
- **Shadow Strategy:** See Elevation; prefer restrained layering over glassy decoration.
- **Internal Padding:** Main panels use `24px`; compact rows use `10px` to `16px`.

### Inputs / Fields
- **Style:** Dark translucent field, Soft Divider border, Warm Ink text, `18px` radius.
- **Focus:** Current fields remove outlines and need a visible accessible focus treatment.
- **Error / Disabled:** Not yet systematized. Future work should add shared error, disabled, loading, and validation states.

### Navigation
- **Style:** Top route nav with pill buttons, transparent inactive states, and accent active state. It is simple and appropriate for the app, but should be made more responsive and clearer on narrow screens.

### Health Data Rows
Metric, trend, summary, and alert rows are the signature components. They should lead with the measurement name, value, unit, status, and recency/source where available. Avoid burying critical context in color alone.

## 6. Do's and Don'ts

### Do:
- **Do** keep data source, recency, units, and safety boundaries visible near relevant actions.
- **Do** preserve high contrast for body text and labels; muted text must still meet WCAG AA on its actual panel.
- **Do** distinguish deterministic analytics from AI-generated interpretation.
- **Do** use restrained layering for dense review screens and reserve bright accents for active or meaningful state.
- **Do** add reduced-motion alternatives for pulse, hover, reveal, or chart animations.

### Don't:
- **Don't** imply diagnosis, treatment, medication changes, urgent triage, or clinical certainty.
- **Don't** use hospital portal aesthetics, alarmist health scores, generic SaaS dashboard polish, or playful gamified wellness patterns.
- **Don't** expand the current glassy panel treatment or wide glow shadows as default decoration.
- **Don't** use oversized display type or tight letter-spacing in narrow product layouts.
- **Don't** use color-only status, undefined CSS variables, or hidden browser focus outlines.