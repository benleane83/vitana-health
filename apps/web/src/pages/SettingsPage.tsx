import { useEffect, useState } from "react";
import type { AiSettings, ModelValidation } from "../api.js";

export function SettingsPage() {
  const [settings, setSettings] = useState<AiSettings>();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function load() {
    try {
      setSettings(await fetchSettings());
    } catch {
      setMessage("Unable to load AI settings.");
    }
  }

  useEffect(() => {
    void load();
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "openrouter-connected") return;
      setMessage(event.data.ok ? "OpenRouter connected." : "OpenRouter connection failed.");
      if (event.data.ok) void load();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const saved = await fetchSettings("/api/settings/ai", {
        method: "PUT",
        body: JSON.stringify({ ...settings, apiKey: apiKey || undefined })
      });
      setSettings(saved);
      setApiKey("");
      setMessage("AI settings saved.");
    } catch {
      setMessage("Unable to save AI settings.");
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/settings/ai/validate", { method: "POST", credentials: "include" });
      const result = (await response.json()) as ModelValidation;
      setMessage(result.ok ? `Connection validated in ${result.elapsedMs} ms.` : result.error ?? "Validation failed.");
    } catch {
      setMessage("Unable to validate AI settings.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <section className="panel"><p className="empty">Loading AI settings…</p></section>;

  return (
    <section className="panel settings-panel">
      <p className="eyebrow">Settings</p>
      <h2>AI setup</h2>
      <p className="empty">Configure the model connection used for AI queries and insights. Your API key is stored on this device and is never displayed.</p>
      <form className="settings-form" onSubmit={save}>
        <label htmlFor="ai-provider">Provider</label>
        <select id="ai-provider" value={settings.provider} disabled={busy} onChange={(event) => setSettings({ ...settings, provider: event.target.value as AiSettings["provider"] })}>
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI-compatible</option>
        </select>
        <label htmlFor="ai-endpoint">Endpoint URL</label>
        <input id="ai-endpoint" type="url" value={settings.endpoint} disabled={busy} onChange={(event) => setSettings({ ...settings, endpoint: event.target.value })} required />
        <label htmlFor="ai-api-key">API key {settings.hasApiKey ? "(saved)" : ""}</label>
        <input id="ai-api-key" type="password" value={apiKey} disabled={busy} placeholder={settings.hasApiKey ? "Leave blank to keep the saved key" : "Required for OpenAI-compatible endpoints"} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
        <label htmlFor="ai-model">Model name</label>
        <input id="ai-model" value={settings.model} disabled={busy} onChange={(event) => setSettings({ ...settings, model: event.target.value })} required />
        <div className="settings-actions">
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
          <button type="button" className="manage-profiles-button" disabled={busy} onClick={() => { void validate(); }}>Validate</button>
        </div>
      </form>
      <div className="settings-openrouter">
        <h3>OpenRouter</h3>
        <p>Connect your OpenRouter account to configure a compatible endpoint automatically.</p>
        <button type="button" disabled={busy} onClick={() => window.open("/api/settings/ai/openrouter/connect", "openrouter-connect", "width=560,height=700")}>Connect OpenRouter</button>
      </div>
      {message ? <p role="status" aria-live="polite">{message}</p> : null}
    </section>
  );
}

async function fetchSettings(path = "/api/settings/ai", options?: RequestInit): Promise<AiSettings> {
  const response = await fetch(path, { ...options, credentials: "include", headers: { "content-type": "application/json", ...options?.headers } });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<AiSettings>;
}
