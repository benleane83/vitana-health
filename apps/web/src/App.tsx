import { useEffect, useMemo, useState } from "react";
import type { AnalyticsSummary, HealthStoreData, Insight, Profile } from "@local-fitness-advisor/shared";
import { safetyNotice } from "@local-fitness-advisor/shared";
import { api } from "./api.js";

const sampleSamsungCsv = `date,type,value,unit
2026-06-25,steps,8421,count
2026-06-26,steps,9630,count
2026-06-27,steps,7102,count
2026-06-28,heart_rate,64,bpm
2026-06-29,heart_rate,61,bpm
2026-06-30,weight,82.4,kg`;

const sampleLabCsv = `date,panelName,marker,value,unit,referenceLow,referenceHigh
2026-06-30,Metabolic panel,HbA1c,5.8,%,4.0,5.7
2026-06-30,Metabolic panel,Glucose,103,mg/dL,70,99
2026-06-30,Lipid panel,HDL cholesterol,48,mg/dL,40,
2026-06-30,Lipid panel,LDL cholesterol,116,mg/dL,,100`;

export function App() {
  const [store, setStore] = useState<HealthStoreData>();
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [selectedImport, setSelectedImport] = useState<"samsung" | "lab">("samsung");
  const [fileName, setFileName] = useState("sample.csv");
  const [csv, setCsv] = useState(sampleSamsungCsv);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void refresh();
  }, []);

  const profile = store?.profile;
  const latestInsight = store?.insights[0];
  const density = useMemo(() => {
    const counts = analytics?.counts;
    if (!counts) return 0;
    return Math.min(100, counts.observations + counts.samples / 10 + counts.labMarkers * 8);
  }, [analytics]);

  async function refresh() {
    const [nextStore, nextAnalytics] = await Promise.all([api.store(), api.analytics()]);
    setStore(nextStore);
    setAnalytics(nextAnalytics);
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run("Profile saved locally.", async () => {
      await api.saveProfile({
        displayName: String(form.get("displayName") || "Local user"),
        birthYear: numberOrUndefined(form.get("birthYear")),
        sex: String(form.get("sex") || "not-specified") as Profile["sex"],
        heightCm: numberOrUndefined(form.get("heightCm")),
        goalSummary: String(form.get("goalSummary") || ""),
        units: String(form.get("units") || "metric") as Profile["units"]
      });
      await refresh();
    });
  }

  async function importCsv() {
    await run("Import processed into the encrypted local store.", async () => {
      if (selectedImport === "samsung") {
        await api.importSamsung(fileName, csv);
      } else {
        await api.importBloodTest(fileName, csv);
      }
      await refresh();
    });
  }

  async function generateInsight() {
    await run("Insight generated from local data.", async () => {
      await api.generateInsight();
      await refresh();
    });
  }

  async function run(success: string, task: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await task();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Private health intelligence / localhost only</p>
          <h1>Your body data, held close.</h1>
          <p className="hero-copy">
            A local analytics cockpit for Samsung Health exports, lab markers, profile context, and guarded AI summaries.
          </p>
        </div>
        <div className="privacy-card">
          <span className="pulse" />
          <strong>Encrypted local vault</strong>
          <p>{store?.sourceImports.length ?? 0} imports. Raw files stay off cloud services.</p>
          <div className="density"><span style={{ width: `${density}%` }} /></div>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section className="grid">
        <article className="panel profile-panel">
          <h2>Profile context</h2>
          <form onSubmit={saveProfile} className="profile-form">
            <label>
              Name
              <input name="displayName" defaultValue={profile?.displayName ?? "Local user"} />
            </label>
            <label>
              Birth year
              <input name="birthYear" type="number" defaultValue={profile?.birthYear ?? ""} />
            </label>
            <label>
              Sex
              <select name="sex" defaultValue={profile?.sex ?? "not-specified"}>
                <option value="not-specified">Prefer not to say</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="intersex">Intersex</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label>
              Height cm
              <input name="heightCm" type="number" step="0.1" defaultValue={profile?.heightCm ?? ""} />
            </label>
            <label>
              Units
              <select name="units" defaultValue={profile?.units ?? "metric"}>
                <option value="metric">Metric</option>
                <option value="imperial">Imperial</option>
              </select>
            </label>
            <label className="wide">
              Goals
              <textarea name="goalSummary" defaultValue={profile?.goalSummary ?? "Improve energy, sleep, and metabolic health."} />
            </label>
            <button disabled={busy}>Save profile</button>
          </form>
        </article>

        <article className="panel import-panel">
          <h2>Import console</h2>
          <div className="segmented">
            <button
              className={selectedImport === "samsung" ? "active" : ""}
              onClick={() => {
                setSelectedImport("samsung");
                setFileName("samsung-health-sample.csv");
                setCsv(sampleSamsungCsv);
              }}
            >
              Samsung Health
            </button>
            <button
              className={selectedImport === "lab" ? "active" : ""}
              onClick={() => {
                setSelectedImport("lab");
                setFileName("blood-test-sample.csv");
                setCsv(sampleLabCsv);
              }}
            >
              Blood test CSV
            </button>
          </div>
          <input value={fileName} onChange={(event) => setFileName(event.target.value)} />
          <textarea className="csv-box" value={csv} onChange={(event) => setCsv(event.target.value)} />
          <button disabled={busy} onClick={importCsv}>Process into vault</button>
        </article>

        <article className="panel metrics-panel">
          <h2>Local analytics</h2>
          <div className="stat-row">
            <Stat label="Imports" value={analytics?.counts.imports ?? 0} />
            <Stat label="Observations" value={analytics?.counts.observations ?? 0} />
            <Stat label="Samples" value={analytics?.counts.samples ?? 0} />
            <Stat label="Labs" value={analytics?.counts.labMarkers ?? 0} />
          </div>
          <div className="metric-list">
            {analytics?.latestMetrics.length ? analytics.latestMetrics.map((metric) => (
              <div className="metric" key={metric.code}>
                <span>{metric.label}</span>
                <strong>{metric.value} {metric.unit}</strong>
                <em data-status={metric.status}>{metric.status}</em>
              </div>
            )) : <p className="empty">Import data to populate latest metrics.</p>}
          </div>
        </article>

        <article className="panel trends-panel">
          <h2>Trend traces</h2>
          {analytics?.trendCards.length ? analytics.trendCards.map((card) => (
            <div className="trend" key={card.code}>
              <div>
                <strong>{card.label}</strong>
                <span>{card.summary}</span>
              </div>
              <MiniChart points={card.points} />
            </div>
          )) : <p className="empty">Two or more dated readings are needed for trend traces.</p>}
        </article>

        <article className="panel insight-panel">
          <h2>Guarded AI review</h2>
          <p className="safety">{safetyNotice}</p>
          <button disabled={busy} onClick={generateInsight}>Generate local insight</button>
          <InsightCard insight={latestInsight} />
        </article>

        <article className="panel alerts-panel">
          <h2>Lab range review</h2>
          {analytics?.labAlerts.length ? analytics.labAlerts.map((alert) => (
            <div className="alert" key={`${alert.marker}-${alert.value}`}>
              <span>{alert.marker}</span>
              <strong>{alert.value} {alert.unit}</strong>
              <em>{alert.flag}{alert.reference ? ` / ref ${alert.reference}` : ""}</em>
            </div>
          )) : <p className="empty">No out-of-range lab markers yet.</p>}
        </article>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function MiniChart({ points }: { points: Array<{ date: string; value: number }> }) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 100 - ((point.value - min) / range) * 80 - 10;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="Trend sparkline">
      <path d={path} />
    </svg>
  );
}

function InsightCard({ insight }: { insight?: Insight }) {
  if (!insight) {
    return <p className="empty">Generate an insight after importing data.</p>;
  }
  return (
    <div className="insight">
      <span>{insight.model} / confidence {insight.confidence}</span>
      <h3>{insight.title}</h3>
      <p>{insight.body}</p>
    </div>
  );
}

function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

