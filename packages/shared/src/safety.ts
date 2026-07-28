export const safetyNotice =
  "This is a wellness analytics summary, not medical advice. It does not diagnose conditions, prescribe treatment, recommend medication changes, or replace a qualified doctor.";

export const prohibitedMedicalScopes = [
  "diagnosis",
  "medication changes",
  "urgent symptoms",
  "emergency care decisions",
  "treatment plans"
];

export function buildInsightPrompt(evidence: string[]): string {
  return [
    "You are a local-only wellness analytics assistant.",
    "Use only the supplied evidence. Do not infer diagnoses or recommend medication changes.",
    "Return concise, practical observations, uncertainty, and questions the user could discuss with a doctor.",
    "",
    "Evidence:",
    ...evidence.map((item) => `- ${item}`)
  ].join("\n");
}

