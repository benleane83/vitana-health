# Product

## Register

product

## Users

People using their own Health Connect, profile, and lab data locally to understand patterns before discussing questions with a clinician. They are usually in a review or investigation workflow: checking what was imported, looking for trends, asking constrained questions, or preparing a more informed health conversation.

## Product Purpose

Vitana Health turns locally stored personal health data into understandable summaries, deterministic analytics, and guarded AI-assisted explanations without sending sensitive data to telemetry, cloud sync, or vendor data pipelines. Success means the user can trust what data exists, see what changed, ask useful questions, and stay inside wellness-oriented safety boundaries.

## Brand Personality

Calm, trustworthy, and data-literate. The product should feel private, composed, and technically transparent without becoming cold, clinical, or ornamental.

## Anti-references

Avoid medical-diagnosis vibes, hospital portal aesthetics, generic SaaS dashboard polish, alarmist health scoring, and playful gamified wellness patterns. The interface should not imply diagnosis, treatment, medication changes, or urgency handling.

## Design Principles

1. Make trust visible: show data freshness, source, scope, and safety boundaries near the decisions they affect.
2. Keep analysis legible: prioritize readable hierarchy, compact evidence, and clear units over decorative density.
3. Stay locally grounded: reinforce the privacy model through interface behavior and copy, not fear-based messaging.
4. Separate signal from suggestion: distinguish deterministic observations from AI-generated interpretation and clinical follow-up prompts.
5. Design for repeat review: favor stable layouts, predictable controls, and quick comparison across time, source, and measurement type.

## Data Retention

Each profile's encrypted local database has no application-defined record ceiling and no automatic eviction policy. Successful imports retain all accepted observations, samples, groups, activities, and source content until the user explicitly deletes data or the profile. A real filesystem or database capacity failure fails and rolls back the import rather than silently discarding older records.

Request byte limits, field validation, paginated reads, bounded query results, and transport chunking remain operational safeguards. They limit individual operations and responses; they do not cap cumulative profile growth.

## Accessibility & Inclusion

Target WCAG AA for contrast, keyboard access, focus visibility, and semantic structure. Respect reduced-motion preferences, keep health-state color meanings text-backed, and favor high legibility for dense personal data.