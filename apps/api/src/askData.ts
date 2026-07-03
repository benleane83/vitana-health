export interface DataAnswerPlan {
  answerLead: string;
  sql: string;
}

export function planDataAnswer(question: string): DataAnswerPlan | undefined {
  const q = question.trim().toLowerCase();

  if (includesAny(q, ["last", "latest", "most recent"]) && includesAny(q, ["heart rate", "hr"])) {
    return {
      answerLead: "Latest heart-rate observation",
      sql: `
        SELECT recorded_at, heart_rate_bpm, unit
        FROM (
          SELECT observed_at AS recorded_at, value AS heart_rate_bpm, unit
          FROM observations
          WHERE measurement_code = 'heart_rate'
          UNION ALL
          SELECT start_at AS recorded_at, value AS heart_rate_bpm, unit
          FROM samples
          WHERE measurement_code = 'heart_rate'
        ) latest_hr
        ORDER BY recorded_at DESC
        LIMIT 1;
      `
    };
  }

  return undefined;
}

function includesAny(input: string, terms: string[]): boolean {
  return terms.some((term) => input.includes(term));
}
