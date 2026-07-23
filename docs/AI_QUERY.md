# AI-Powered Natural Language Query (`/api/query/ai`)

The AI query endpoint provides broad natural-language coverage over your local warehouse using a **DSL -> SQL compiler pipeline** with safety guardrails.

## Architecture

```text
question -> AI DSL planner -> validate shape and semantics -> compile to SQL -> validate SQL -> execute DuckDB -> summarize answer
```

1. **AI DSL Planner** (`aiQueryPlanner.ts`) requests a strict JSON query DSL (not raw SQL), then validates its Zod shape and source/intent/metric semantics. Compatible models receive a JSON Schema; BYO endpoints that reject schema controls fall back to the same prompt contract.
2. **DSL Compiler** (`queryCompiler.ts`) maps the validated DSL to parameterized SQL templates only; no free-form SQL from the model.
3. **SQL Validator** runs a separate safety pass that denies disallowed tokens and non-whitelisted identifiers even though SQL is compiler-produced.
4. **DuckDB execution** runs the validated query against your local warehouse.
5. **Answer summarization** returns a one-sentence answer from the evidence rows.

Malformed JSON, schema errors, semantic errors, and compiler-rejected plans receive at most one model repair attempt. SQL safety or database execution failures never trigger model repair.

## Request

```powershell
$body = @{ question = "average heart rate last month" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/query/ai" -ContentType "application/json" -Body $body
```

Optional fields:

- `timezone` (IANA string)
- `debug` (boolean, adds planner timing to response)

## Response fields

| Field | Description |
|---|---|
| `outcome` | `answered` or `no_data`; valid no-data queries remain successful `200` responses |
| `answer` | Natural-language answer from the model |
| `plan` | The structured DSL returned by the planner |
| `sourceResolved` / `intentResolved` | The dataset and operation selected by the planner/compiler |
| `sql` | The compiler-produced SQL that was executed |
| `rows` | Up to 100 result rows |
| `chart` | Optional chart-ready series `{ type, series: [{label, value}] }` |
| `confidence` | Internal heuristic retained for diagnostics; it is not displayed as calibrated certainty |
| `limitations` | Any caveats or planner assumptions |
| `resolvedTimeRange` | The exact date range applied to the query |

## Supported query classes

- Time-series trends: `steps trend this week`, `daily heart rate last month`
- Aggregations: `average heart rate last month`, `total steps this month`
- Top-N: `max daily steps this month`, `top 10 step days`
- Latest reading: `latest heart rate`
- Activity summaries: `top exercises this month`
- Health events: `list immunizations this year`, `weekly health event counts`, `latest medication administration`
- Care items: `open high-priority care items due this month`, `care items by status`, `how many care items are overdue?`

## Safety guardrails

- **SELECT-only**: non-SELECT tokens (`DROP`, `DELETE`, `INSERT`, `UPDATE`, `CREATE`, and related statements) are blocked at both compile and validate stages.
- **Table/column whitelist**: only the metric views, `activities`, `v_ai_health_events`, and `v_ai_care_items` with their known columns are allowed.
- **Time window cap**: maximum 366-day time window per query.
- **Row limit cap**: maximum 200 rows per query.
- **Graceful fallback**: unsupported questions return a clarifying limitations message and suggested rephrase rather than raw model output.
- **Bounded repair**: model-controlled plan failures permit one repair call; compiler safety and execution failures permit none.
- **Private diagnostics**: `debug: true` adds categories, attempt counts, structured-output mode, and timings, but never raw questions, result rows, API keys, or full model responses.

## Time semantics

Calendar month/week boundaries are resolved server-side before SQL compilation:

| Phrase | Resolved range |
|---|---|
| `this month` | First day to last day of current calendar month |
| `last month` | First day to last day of previous calendar month |
| `this week` | Monday to Sunday of current week |
| `last week` | Monday to Sunday of previous week |
| `last 30d` (default) | Rolling 30 days from today |

## Known limitations

- The AI planner requires a running model runtime (Ollama or OpenAI-compatible). If the model is unavailable, a graceful error with suggested rephrases is returned.
- Compound queries (for example, steps and heart rate together) may be simplified to the first metric.
- Cross-source comparisons are not supported; each query targets one dataset.
- Health events support list, count, latest, and day/week count trends. Care items support list, grouped count, due-window, and overdue queries.
- Lab marker questions are not currently supported by the AI query endpoint; review lab results in the Labs and Summary views.

## Model compatibility

The AI Settings **Validate** action sends one representative semantic planner probe, which also checks connectivity. Models that pass the probe are reported as compatible. A failure produces a warning but does not block saving or use. Structured JSON Schema is treated as a capability: Ollama and compatible OpenAI/OpenRouter models use it, while other BYO endpoints may use prompt-only fallback. Use a fixed model rather than `openrouter/free` when measuring repeatability because the free router may select different models between calls.
