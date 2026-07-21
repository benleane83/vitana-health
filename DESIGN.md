---
name: "Vitana Health"
description: "A calm, private health workspace with one identity across desktop and mobile."
colors:
  canvas: "oklch(97% 0.008 255)"
  canvas-alt: "oklch(95% 0.012 262)"
  surface: "oklch(99% 0.004 260)"
  surface-soft: "oklch(96% 0.012 254)"
  surface-strong: "oklch(94% 0.017 252)"
  surface-warm: "oklch(97% 0.02 45)"
  text: "oklch(30% 0.07 275)"
  text-strong: "oklch(23% 0.08 275)"
  text-muted: "oklch(48% 0.04 272)"
  text-subtle: "oklch(56% 0.036 266)"
  line: "oklch(86% 0.02 260)"
  line-strong: "oklch(79% 0.03 258)"
  primary: "oklch(46% 0.13 278)"
  primary-strong: "oklch(40% 0.15 278)"
  primary-soft: "oklch(92% 0.04 284)"
  lavender-soft: "oklch(95% 0.026 300)"
  info: "oklch(79% 0.08 190)"
  info-strong: "oklch(39% 0.085 195)"
  info-soft: "oklch(95% 0.035 190)"
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
  ink-on-accent: "oklch(99% 0.004 260)"
typography:
  display:
    fontFamily: "Aptos Display, Aptos, Segoe UI, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1.28rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1.04rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 700
    lineHeight: 1.25
rounded:
  xs: "6px"
  pill: "999px"
  sm: "8px"
  md: "12px"
  lg: "16px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.72rem 1rem"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.ink-on-accent}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.72rem 1rem"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.72rem 0.86rem"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  message-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info-strong}"
    rounded: "{rounded.md}"
    padding: "14px"
  message-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success-strong}"
    rounded: "{rounded.md}"
    padding: "14px"
  message-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-strong}"
    rounded: "{rounded.md}"
    padding: "14px"
---

# Design System: Vitana Health

## Overview

**Creative North Star: "The Private Health Workspace"**

Vitana Health is a calm place to inspect personal health data, understand patterns, and support informed everyday wellness choices. The visual system makes privacy, provenance, freshness, units, and safety boundaries easy to see without adopting hospital-portal severity or wellness-game optimism.

Design serves repeated review. Stable structure and familiar controls matter more than novelty; restrained indigo carries action and selection, while lavender, seafoam, blush, and semantic tones clarify state. The interface is composed and confident, with enough warmth to feel personal but no decoration that competes with health data.

**Current Product Direction: Wellness First.** The current experience prioritizes personal reflection, habit awareness, and understandable health-data exploration. The existing dashboard hero, wellness warmth, and brand identity remain intentional and should not be reworked toward a clinician-preparation or clinical-evidence aesthetic. Clinician briefs, appointment-prep flows, print/export handoffs, and added clinical language are deferred until an explicit product decision revisits them. Privacy, provenance, and careful non-diagnostic language remain core trust requirements.

One identity spans the desktop web app and mobile companion, but composition remains platform-native. Shared tokens, type roles, state names, icon meanings, and trust language are generated from one platform-neutral source. Web consumes CSS custom properties; React Native consumes typed sRGB values and numeric dimensions. DOM components, CSS layout, React Navigation, camera controls, safe areas, TalkBack behavior, and other platform affordances are never shared as visual components.

**Key Characteristics:**
- Light, cool-tinted canvases with clear tonal surface layers.
- Indigo action and selection, supported by lavender, seafoam, and blush.
- Compact evidence hierarchy with explicit units, source, recency, and state text.
- Medium-radius containers, pill controls, and borders before shadows.
- State-based motion only, normally 150–220ms, with reduced-motion support.
- Native interaction patterns carrying the same semantic identity on every platform.

**The One Source Rule.** A single semantic token module must emit web CSS variables and typed React Native values. Never maintain a web palette, mobile palette, and pairing palette independently. Canonical OKLCH values may be converted to sRGB for React Native; generated outputs are not hand-edited.

**The Meaning Before Markup Rule.** Share what a component means, not how one platform renders it. A warning has the same semantic role, title/detail/action content contract, icon meaning, and color family everywhere, while its web and native controls remain idiomatic.

## Colors

The palette is cool, quiet, and evidence-led: deep indigo text and actions sit on near-white blue-violet canvases, with low-chroma accents reserved for identity and state.

### Primary
- **Private Indigo:** The primary action, selected destination, selected chip, active chart series, and strongest interactive emphasis.
- **Pressed Indigo:** Hover and pressed treatment for primary actions; never a decorative second accent.
- **Indigo Wash:** Selection backgrounds, quiet emphasis, and identity moments that need less force than a solid action.

### Secondary
- **Lavender Air:** A supportive identity surface used in the dashboard welcome treatment and other rare brand moments.
- **Seafoam Signal:** Informational state and data-support color. Its strong tone is for readable text and icons; its soft tone is for backgrounds.

### Tertiary
- **Measured Blush:** Supportive emphasis for selected identity moments and non-alarmist highlights. It is not an error color.
- **Warm Review Surface:** A rare warm-neutral surface for review context. It must not become the application canvas.

### Neutral
- **Cool Canvas / Alternate Canvas:** The application background and subtle section transition.
- **Evidence Surface / Soft Surface / Strong Surface:** The three tonal layers for content, grouped controls, and stronger separation.
- **Evidence Ink / Strong Ink:** Body content and primary headings.
- **Muted Ink / Subtle Ink:** Secondary metadata. Muted text must still meet WCAG AA on its surface.
- **Quiet Line / Strong Line:** Dividers, control borders, and dialog boundaries.
- **Ink on Accent:** Text and icons placed on solid primary or selected-state fills.

### Semantic State
- **Success:** Confirmed completion, healthy connection, or accepted data. Always paired with text.
- **Warning:** Review-needed, stale, or degraded state. It never implies a diagnosis or emergency.
- **Danger:** Destructive action or actionable failure. It is not used for out-of-range health values without an explicit quality interpretation.
- **Focus:** A 3px visible focus ring on web and the nearest platform-native accessible focus treatment on mobile.

**The Accent Rarity Rule.** Solid primary is reserved for primary actions and current selection. Lavender, seafoam, and blush support meaning; they do not tint every panel.

**The Paired State Rule.** Every semantic background uses its corresponding strong text/icon tone, and every color-coded state includes a visible text label. Pastel colors are forbidden for body text.

**The Trust Color Rule.** Health values do not become red, amber, or green from a numeric comparison alone. Quality and range semantics must be determined by shared domain logic before visual state is assigned.

## Typography

**Display Font:** Aptos Display with Aptos, Segoe UI, and platform sans fallbacks

**Body Font:** Aptos with Segoe UI and platform sans fallbacks

**Label Font:** Aptos with Segoe UI and platform sans fallbacks

**Character:** One humanist sans family keeps controls, evidence, and explanatory prose coherent. Weight and spacing create hierarchy; decorative font pairing is unnecessary in a private data tool.

### Hierarchy
- **Display** (700, 2.25rem maximum, 1.08): Page identity and the rare dashboard welcome heading. On native mobile, map to approximately 26–28 logical pixels rather than reproducing desktop scale.
- **Headline** (800, 1.28rem, 1.15): Major section heading and dialog title.
- **Title** (800, 1.04rem, 1.2): Panel, metric group, and row-group heading.
- **Body** (400, 1rem, 1.5): Instructions, evidence explanations, and values in context. Explanatory prose stays within 65–75 characters per line.
- **Label** (700, 0.9rem, 1.25): Buttons, tabs, field labels, and compact metadata. Sentence case is the default; uppercase is reserved for true abbreviations.

**The Fixed Product Scale Rule.** Product typography uses stable role sizes, not viewport-fluid type. Mobile maps roles to native numeric sizes and supports dynamic type without truncating health values or actions.

**The Evidence Order Rule.** Measurement rows scan in this order: name, formatted value, unit, quality state, observed time, and source. Never use weight or size to make a raw number look authoritative before its unit and quality are known.

## Elevation

The system is tonal and flat at rest. Depth comes from canvas-to-surface contrast, 1px semantic lines, and spacing. Wide shadows are reserved for transient overlays such as profile menus and dialogs; they are structural escape cues, not card decoration. React Native uses border and tonal layering for ordinary content and may use restrained native elevation only for an active modal or floating transient surface.

### Shadow Vocabulary
- **Popover Lift** (`0 16px 34px oklch(34% 0.03 255 / 0.2)`): Menus and compact surfaces that must visibly escape surrounding content.
- **Dialog Lift** (`0 20px 42px oklch(35% 0.04 260 / 0.2)`): Modal dialogs above a dimmed backdrop.
- **Inset Signal** (`inset 0 0 0 12px oklch(80% 0.08 190 / 0.24)`): The existing dashboard privacy pulse only; not a general card treatment.

**The Flat-by-Default Rule.** Static panels never combine a 1px border with a wide drop shadow. If every card appears to float, elevation has failed.

**The Overlay-Only Rule.** Shadows communicate stacking and temporary escape. A modal may lift; a metric row may not.

## Components

Components share semantic roles, spacing rhythm, content contracts, and state behavior. Their actual controls remain native to web or mobile.

### Buttons
- **Shape:** Full pill on web and a familiar, comfortably rounded native control on mobile; minimum touch height is 44px on web and 48 logical pixels on mobile.
- **Primary:** Private Indigo with Ink on Accent, label typography, and one clear command.
- **Hover / Focus / Pressed:** Web darkens to Pressed Indigo over 180ms and uses a 3px focus ring. Mobile uses pressed opacity/tone and platform accessibility focus without hover mimicry.
- **Secondary:** Evidence Surface, Quiet Line border, and Evidence Ink. Destructive actions use Danger with explicit destructive copy.
- **Loading / Disabled:** Preserve the label or replace it with a specific progress label. Disabled opacity is 0.52 and must not be the only explanation for unavailability.

### Chips
- **Style:** Pill shape with a surface background, Quiet Line border, readable label, and at least a 44px effective touch target.
- **State:** Selected chips use solid Private Indigo and Ink on Accent. Web exposes `aria-selected` or `aria-pressed`; native exposes the matching accessibility role and selected state.
- **Density:** More than four simultaneous choices require grouping, search, presets, or progressive disclosure. Do not ship an undifferentiated wall of chips.

### Cards / Containers
- **Corner Style:** Gently curved evidence surfaces (12–16px).
- **Background:** Evidence Surface for primary content; Soft Surface for grouped controls and subordinate regions.
- **Shadow Strategy:** Flat at rest; see Elevation.
- **Border:** One 1px Quiet Line boundary when tone alone does not establish grouping.
- **Internal Padding:** 16–24px on web; 14–20 logical pixels on mobile.
- **Composition:** Cards are for bounded records, actions, and repeated items. Page sections and every dashboard statistic must not become identical cards.

### Inputs / Fields
- **Style:** Evidence Surface, 1px Quiet Line, 12px radius, visible label above the field, and readable placeholder text.
- **Focus:** 3px Focus ring with 3px offset on web; the strongest idiomatic accessible focus treatment available on native.
- **Error / Disabled:** Field-level message below the field with semantic color, icon or text label, and a recovery instruction. Validation cannot wait until a whole import is submitted when the field can be checked immediately.
- **Health Data:** Measurement and unit selection must come from shared metadata. Free-text codes and unconstrained unit strings are prohibited where a registry value exists.

### Navigation
- **Web:** Sticky pill-shaped route navigation with transparent inactive items and a solid-primary active destination.
- **Mobile:** Native bottom tabs and stacks using the same labels, icon meanings, active Primary color, and inactive Muted Ink. Use one icon library; text glyphs such as `⌂`, `＋`, and `⌁` are not the icon system.
- **Connection:** Connection is a persistent status/action, not a peer content destination. Its label must include the meaningful state where space permits.

### Status and Trust Messages
- **Content contract:** Every status has a user-facing title, optional detail, semantic tone, accessible announcement behavior, and direct recovery or next action when one exists.
- **Language:** Say “Connected to your PC,” “Waiting for approval on your PC,” or “Connection needs attention.” Never render raw machine states by replacing hyphens with spaces.
- **Freshness:** “Just now” is computed from a real timestamp. Otherwise show a meaningful relative or absolute time.
- **Provenance:** Health evidence displays source and observed time near the value; import completion reports accepted, skipped, and review-needed counts.
- **Safety:** Trust language is calm and precise. It explains local storage and availability without fear-based privacy copy.

### Motion and Responsive Behavior
- **Timing:** State transitions use 150–220ms ease-out timing. Progress width may use up to 240ms.
- **Reduced Motion:** Web respects `prefers-reduced-motion`; native respects the platform reduce-motion setting.
- **Mobile Composition:** Reorder and disclose information for handheld use instead of shrinking desktop grids. The first viewport prioritizes profile, connection/freshness, review-needed state, latest evidence, and one next action.

**The Complete State Rule.** Interactive components require default, focus, pressed/active, disabled, loading, error, and selected states when applicable. A component with only default styling is unfinished.

## Do's and Don'ts

### Do:
- **Do** generate web CSS custom properties and typed React Native values from one platform-neutral semantic token source.
- **Do** preserve the current indigo, lavender, seafoam, blush, cool-canvas, and semantic-state vocabulary across platforms.
- **Do** keep platform controls native while sharing roles, status language, icon meanings, and evidence formatting.
- **Do** show freshness, source, scope, units, quality, and safety boundaries near the decisions they affect.
- **Do** target WCAG AA contrast, visible focus, dynamic type, TalkBack semantics, and text-backed health states.
- **Do** distinguish deterministic observations from AI-generated interpretation and clinical follow-up prompts.
- **Do** use stable layouts, predictable controls, and quick comparison for repeat review.

### Don't:
- **Don't** maintain independent web, mobile, or pairing color literals. `PairScreen` and every mobile screen must consume generated semantic tokens.
- **Don't** share React DOM or React Native visual components across platforms; share tokens, content contracts, domain presentation models, and deterministic behavior.
- **Don't** use medical-diagnosis vibes, hospital portal aesthetics, generic SaaS dashboard polish, alarmist health scoring, or playful gamified wellness patterns.
- **Don't** imply diagnosis, treatment, medication changes, clinical certainty, or urgency handling.
- **Don't** introduce clinician-preparation flows, clinician briefs, appointment-oriented exports, or additional clinical framing without an explicit product-direction change.
- **Don't** replace the current dashboard hero or wellness-forward brand identity solely to make the product resemble a clinical evidence workspace.
- **Don't** use gradient text, side-stripe card accents, decorative grid overlays, glassmorphism, or wide card shadows.
- **Don't** use pastel accents for body text or color alone to communicate status.
- **Don't** over-round cards beyond 16px or nest cards inside cards.
- **Don't** render raw connection states, unformatted measurement values, or unsupported units as trusted user-facing evidence.
- **Don't** use a tiny uppercase eyebrow above every section or repeat identical metric cards as the default dashboard structure.
