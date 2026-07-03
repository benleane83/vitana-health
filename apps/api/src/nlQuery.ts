interface PlannedQuery {
  sql: string;
  answerLead: string;
}

export function planWarehouseQuery(question: string): PlannedQuery | undefined {
  const q = question.trim().toLowerCase();

  if (includesAny(q, ["steps", "step"]) && includesAny(q, ["trend", "last", "past", "week", "month"])) {
    return {
      answerLead: "Step trend summary",
      sql: `
        SELECT day, avg_value AS steps
        FROM v_daily_metrics
        WHERE measurement_code = 'steps'
          AND day >= (SELECT COALESCE(MAX(day), CURRENT_DATE) FROM v_daily_metrics) - INTERVAL 30 DAY
        ORDER BY day;
      `
    };
  }

  if (includesAny(q, ["heart rate", "hr"]) && includesAny(q, ["trend", "weekly", "month", "past", "last"])) {
    return {
      answerLead: "Heart-rate trend summary",
      sql: `
        SELECT day, avg_value AS heart_rate_bpm
        FROM v_daily_metrics
        WHERE measurement_code = 'heart_rate'
          AND day >= (SELECT COALESCE(MAX(day), CURRENT_DATE) FROM v_daily_metrics) - INTERVAL 30 DAY
        ORDER BY day;
      `
    };
  }

  if (includesAny(q, ["oxygen", "spo2", "saturation"])) {
    return {
      answerLead: "Oxygen saturation summary",
      sql: `
        SELECT day, avg_value AS spo2_avg, min_value AS spo2_min, max_value AS spo2_max
        FROM v_daily_metrics
        WHERE measurement_code = 'oxygen_saturation'
          AND day >= (SELECT COALESCE(MAX(day), CURRENT_DATE) FROM v_daily_metrics) - INTERVAL 30 DAY
        ORDER BY day;
      `
    };
  }

  if (includesAny(q, ["hrv", "sdnn", "rmssd"])) {
    return {
      answerLead: "HRV trend summary",
      sql: `
        SELECT day, measurement_code, avg_value
        FROM v_daily_metrics
        WHERE measurement_code IN ('hrv_sdnn', 'hrv_rmssd')
          AND day >= (SELECT COALESCE(MAX(day), CURRENT_DATE) FROM v_daily_metrics) - INTERVAL 45 DAY
        ORDER BY day, measurement_code;
      `
    };
  }

  if (includesAny(q, ["activity", "active"]) && includesAny(q, ["level", "trend", "score"])) {
    return {
      answerLead: "Activity-level trend summary",
      sql: `
        SELECT day, avg_value AS activity_level_avg
        FROM v_daily_metrics
        WHERE measurement_code = 'activity_level'
          AND day >= (SELECT COALESCE(MAX(day), CURRENT_DATE) FROM v_daily_metrics) - INTERVAL 30 DAY
        ORDER BY day;
      `
    };
  }

  if (includesAny(q, ["top", "highest", "max"]) && includesAny(q, ["step", "steps"])) {
    return {
      answerLead: "Highest-step days",
      sql: `
        SELECT day, avg_value AS steps
        FROM v_daily_metrics
        WHERE measurement_code = 'steps'
        ORDER BY avg_value DESC
        LIMIT 10;
      `
    };
  }

  return {
    answerLead: "Available daily metrics (preview)",
    sql: `
      SELECT day, measurement_code, avg_value, unit
      FROM v_daily_metrics
      ORDER BY day DESC, measurement_code
      LIMIT 50;
    `
  };
}

function includesAny(input: string, terms: string[]): boolean {
  return terms.some((term) => input.includes(term));
}
