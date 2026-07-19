export const dailyMetricsViewSql = `
  CREATE OR REPLACE VIEW v_daily_metrics AS
  WITH daily_source_metrics AS (
    SELECT
      DATE(observed_at) AS day,
      measurement_code,
      AVG(value) AS avg_value,
      MIN(value) AS min_value,
      MAX(value) AS max_value,
      COUNT(*) AS n,
      MIN(unit) AS unit
    FROM observations
    GROUP BY 1, 2
    UNION ALL
    SELECT
      DATE(start_at) AS day,
      measurement_code,
      CASE WHEN measurement_code = 'steps' THEN SUM(value) ELSE AVG(value) END AS avg_value,
      MIN(value) AS min_value,
      MAX(value) AS max_value,
      COUNT(*) AS n,
      MIN(unit) AS unit
    FROM time_series_samples
    GROUP BY 1, 2
  )
  SELECT
    day,
    measurement_code,
    SUM(avg_value * n) / NULLIF(SUM(n), 0) AS avg_value,
    MIN(min_value) AS min_value,
    MAX(max_value) AS max_value,
    SUM(n) AS n,
    MIN(unit) AS unit
  FROM daily_source_metrics
  GROUP BY 1, 2
`;

export const weeklyMetricsViewSql = `
  CREATE OR REPLACE VIEW v_weekly_metrics AS
  SELECT
    DATE_TRUNC('week', day) AS week_start,
    measurement_code,
    AVG(avg_value) AS avg_value,
    MIN(min_value) AS min_value,
    MAX(max_value) AS max_value,
    SUM(n) AS n,
    MIN(unit) AS unit
  FROM v_daily_metrics
  GROUP BY 1, 2
`;

export const aiHealthEventsViewSql = `
  CREATE OR REPLACE VIEW v_ai_health_events AS
  SELECT id, kind, status, occurred_at, occurred_end, source, provider, notes
  FROM health_events
`;

export const aiCareItemsViewSql = `
  CREATE OR REPLACE VIEW v_ai_care_items AS
  SELECT id, kind, code, title, due_start, due_end, priority, status, completed_at, notes
  FROM care_items
`;