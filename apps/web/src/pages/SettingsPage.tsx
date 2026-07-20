import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { api } from "../api.js";
import type { AiSettings, DesktopRuntimeSettings } from "../api.js";
import type { SettingsView } from "../types.js";

export function SettingsPage({ view, onViewChange }: {
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
}) {
  const tabs: Array<{ view: SettingsView; id: string; panelId: string; label: string }> = [
    { view: "app", id: "settings-tab-app", panelId: "settings-panel-app", label: "App" },
    { view: "ai", id: "settings-tab-ai", panelId: "settings-panel-ai", label: "AI" }
  ];

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentView: SettingsView) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.findIndex((tab) => tab.view === currentView);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    onViewChange(tabs[nextIndex].view);
    document.getElementById(tabs[nextIndex].id)?.focus();
  }

  return (
    <section className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <p>Manage application preferences and AI connections.</p>
      </div>
      <div className="settings-workspace">
        <div className="settings-tabs" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
          {tabs.map((tab) => (
            <button
              key={tab.view}
              id={tab.id}
              role="tab"
              aria-selected={view === tab.view}
              aria-controls={tab.panelId}
              className={view === tab.view ? "active" : ""}
              tabIndex={view === tab.view ? 0 : -1}
              onClick={() => onViewChange(tab.view)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.view)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {view === "app" ? (
          <div id="settings-panel-app" role="tabpanel" aria-labelledby="settings-tab-app">
            <AppSettingsPanel />
          </div>
        ) : (
          <div id="settings-panel-ai" role="tabpanel" aria-labelledby="settings-tab-ai">
            <AiSettingsPanel />
          </div>
        )}
      </div>
    </section>
  );
}

function AppSettingsPanel() {
  const [settings, setSettings] = useState<DesktopRuntimeSettings>();
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function load() {
    setLoadError(undefined);
    try {
      setSettings(await api.settings.desktop.get());
    } catch {
      setLoadError("Unable to load app settings.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggle(enabled: boolean) {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, backgroundServiceEnabled: enabled });
    setBusy(true);
    setMessage(undefined);
    try {
      setSettings(await api.settings.desktop.save({ backgroundServiceEnabled: enabled }));
      setMessage(enabled ? "Background service enabled." : "Background service disabled.");
    } catch (error) {
      setSettings(previous);
      setMessage(error instanceof Error ? error.message : "Unable to save app settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-panel">
      <h2>App</h2>
      {loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => { void load(); }}>Retry</button>
        </div>
      ) : !settings ? (
        <p className="empty">Loading app settings…</p>
      ) : settings.supported ? (
        <label className="settings-switch">
          <span>
            <strong>Keep the service running in the background</strong>
            <small>Keep mobile sync available after closing the window and start the service at login.</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.backgroundServiceEnabled}
            disabled={busy}
            onChange={(event) => { void toggle(event.target.checked); }}
          />
        </label>
      ) : (
        <p className="empty">Desktop preferences will appear here when available.</p>
      )}
      {message ? <p role="status" aria-live="polite">{message}</p> : null}
    </section>
  );
}

function AiSettingsPanel() {
  const [settings, setSettings] = useState<AiSettings>();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [loadError, setLoadError] = useState<string>();

  async function load() {
    setLoadError(undefined);
    try {
      setSettings(await api.settings.ai.get());
    } catch {
      setLoadError("Unable to load AI settings.");
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
    setBusy(true);
    setMessage(undefined);
    try {
      await persistSettings();
      setMessage("AI settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save AI settings.");
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    if (!settings) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await persistSettings();
      const result = await api.settings.ai.validate();
      setMessage(result.ok ? `Connection validated in ${result.elapsedMs} ms.` : result.error ?? "Validation failed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to validate AI settings.");
    } finally {
      setBusy(false);
    }
  }

  async function persistSettings() {
    if (!settings) throw new Error("AI settings are unavailable");
    const saved = await api.settings.ai.save({
      provider: settings.provider,
      endpoint: settings.endpoint,
      apiKey: apiKey || undefined,
      model: settings.model,
      timeoutMs: settings.timeoutMs
    });
    setSettings(saved);
    setApiKey("");
  }

  if (!settings) return (
    <section className="panel">
      {loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => { void load(); }}>Retry</button>
        </div>
      ) : <p className="empty">Loading AI settings…</p>}
    </section>
  );

  return (
    <section className="panel settings-panel">
      <h2>AI setup</h2>
      <p className="empty">Configure the model connection used for AI queries and insights. Your API key is stored by the local application server and is never displayed.</p>
      <form className="settings-form" onSubmit={save}>
        <label htmlFor="ai-provider">Provider</label>
        <select id="ai-provider" value={settings.provider} disabled={busy} onChange={(event) => setSettings({ ...settings, provider: event.target.value as AiSettings["provider"] })}>
          <option value="ollama">Ollama</option>
          <option value="openai">Cloud API</option>
        </select>
        <label htmlFor="ai-endpoint">Endpoint URL</label>
        <input id="ai-endpoint" type="url" value={settings.endpoint} disabled={busy} onChange={(event) => setSettings({ ...settings, endpoint: event.target.value })} aria-describedby="ai-endpoint-help" required />
        <p id="ai-endpoint-help" className="empty">Supported: OpenRouter, OpenAI, Anthropic, Foundry, Azure OpenAI, and AWS Bedrock.</p>
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
