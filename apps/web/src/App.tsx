import { useEffect, useMemo, useRef, useState } from "react";
import { defaultMeasurementTypes, safetyNotice } from "@local-fitness-advisor/shared";
import type { AppRoute, ImportMode, InsightsTab } from "./types.js";
import { ProfileLifecycleDialogs, useProfileLifecycle } from "./features/profiles/useProfileLifecycle.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ImportPage } from "./pages/ImportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { InsightsRoute } from "./features/insights/InsightsRoute.js";
import { ExportRoute } from "./features/export/ExportRoute.js";
import { TrackRoute } from "./features/track/TrackRoute.js";
import { DashboardRoute } from "./features/dashboard/DashboardRoute.js";

export function App() {
  const [message, setMessage] = useState<string>();
  const [route, setRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [insightsTab, setInsightsTab] = useState<InsightsTab>(() => insightsTabFromPathname(window.location.pathname));
  const [importMode, setImportMode] = useState<ImportMode>(() => importModeFromPathname(window.location.pathname));
  const [summaryDetailCode, setSummaryDetailCode] = useState<string | undefined>(
    () => summaryDetailCodeFromPathname(window.location.pathname)
  );
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  // Accessible confirmation dialog state (replaces window.confirm)
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileLifecycle = useProfileLifecycle(setMessage, confirm);
  const { bootstrap, analytics, profiles, activeProfileId, profile, activeProfile } = profileLifecycle;

  const recordedMeasurementTypes = useMemo(() => {
    const measurementTypes = bootstrap?.measurementTypes?.length
      ? bootstrap.measurementTypes
      : defaultMeasurementTypes;
    return [...measurementTypes].sort((left, right) => left.display.localeCompare(right.display));
  }, [bootstrap?.measurementTypes]);

  // Popstate (browser back/forward)
  useEffect(() => {
    const onPopState = () => {
      setRoute(routeFromPathname(window.location.pathname));
      setInsightsTab(insightsTabFromPathname(window.location.pathname));
      setImportMode(importModeFromPathname(window.location.pathname));
      setSummaryDetailCode(summaryDetailCodeFromPathname(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [profileMenuOpen]);

  function navigate(nextRoute: AppRoute, nextImportMode: ImportMode = importMode) {
    const routePaths: Record<AppRoute, string> = {
      dashboard: "/",
      import: importModePath(nextImportMode),
      track: trackPath(),
      insights: insightsPath(insightsTab),
      export: "/export",
      settings: "/settings"
    };
    const nextPath = routePaths[nextRoute] ?? "/";
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    if (nextRoute === "import") setImportMode(nextImportMode);
    if (nextRoute === "track") setSummaryDetailCode(undefined);
    setRoute(nextRoute);
  }

  function navigateInsights(nextTab: InsightsTab) {
    const nextPath = insightsPath(nextTab);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setInsightsTab(nextTab);
    setRoute("insights");
  }

  function navigateSummaryDetail(measurementCode: string) {
    const nextPath = trackPath(measurementCode);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setRoute("track");
    setSummaryDetailCode(measurementCode);
  }

  function confirm(
    title: string,
    description: string,
    confirmLabel: string,
    destructive: boolean
  ): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmState({
        title,
        description,
        confirmLabel,
        destructive,
        onConfirm: () => {
          setConfirmState(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirmState(null);
          resolve(false);
        }
      });
    });
  }

  // ─── Navigation tabs ─────────────────────────────────────────────────────────

  const navTabIds: Record<AppRoute, string> = {
    dashboard: "nav-tab-dashboard",
    import: "nav-tab-import",
    track: "nav-tab-track",
    insights: "nav-tab-insights",
    export: "nav-tab-export",
    settings: "nav-tab-settings"
  };

  return (
    <main className="shell">
      {/* Navigation tablist */}
      <nav className="route-nav" aria-label="Page navigation">
        <div className="route-nav-main" role="tablist" aria-label="App sections">
          {(["dashboard", "import", "track", "insights", "export"] as AppRoute[]).map((r) => {
            const labels: Record<AppRoute, string> = {
              dashboard: "Dashboard",
              import: "Import",
              track: "Track",
              insights: "Insights",
              export: "Export",
              settings: "Settings"
            };
            const panelId = `route-panel-${r}`;
            return (
              <button
                key={r}
                id={navTabIds[r]}
                role="tab"
                aria-selected={route === r}
                aria-controls={panelId}
                className={route === r ? "active" : ""}
                tabIndex={route === r ? 0 : -1}
                onClick={() => {
                  setProfileMenuOpen(false);
                  navigate(r);
                }}
              >
                {labels[r]}
              </button>
            );
          })}
        </div>
        <div className="route-nav-actions">
          <button
            type="button"
            id={navTabIds.settings}
            className={route === "settings" ? "active settings-button" : "settings-button"}
            aria-label="Settings"
            aria-pressed={route === "settings"}
            onClick={() => {
              setProfileMenuOpen(false);
              navigate("settings");
            }}
          >
            <span aria-hidden="true">⚙</span>
          </button>
          <div className="profile-menu" ref={profileMenuRef}>
          <button
            type="button"
            className="active-profile-pill profile-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
          >
            <span className="profile-menu-label">{activeProfile?.displayName ?? "Profile"}</span>
            <span className="profile-menu-chevron" aria-hidden="true">▾</span>
          </button>
          {profileMenuOpen ? (
            <div className="profile-menu-popover" role="menu" aria-label="Profile actions">
              <p className="profile-menu-title">Switch profile</p>
              {profiles.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={entry.id === activeProfileId}
                  className={`profile-menu-item ${entry.id === activeProfileId ? "active" : ""}`}
                  onClick={() => {
                    setProfileMenuOpen(false);
                    if (entry.id !== activeProfileId) {
                      void profileLifecycle.switchProfile(entry.id);
                    }
                  }}
                >
                  {entry.displayName}
                </button>
              ))}
              <div className="profile-menu-divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="profile-menu-item"
                onClick={() => {
                  setProfileMenuOpen(false);
                  profileLifecycle.openManager();
                }}
              >
                Manage profiles
              </button>
            </div>
          ) : null}
          </div>
        </div>
      </nav>

      {/* Global status/notice — live region */}
      {message ? (
        <div className="notice">
          <span className="notice-message" role="status" aria-live="polite" aria-atomic="true">
            {message}
          </span>
          <button
            className="notice-dismiss"
            type="button"
            aria-label="Dismiss notification"
            title="Dismiss notification"
            onClick={() => setMessage(undefined)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      {/* Route panels */}
      <div
        id="route-panel-dashboard"
        role="tabpanel"
        aria-labelledby={navTabIds.dashboard}
        hidden={route !== "dashboard"}
      >
        {route === "dashboard" ? (
          <DashboardRoute
            bootstrap={bootstrap}
            analytics={analytics}
            profile={profile}
            activeProfile={activeProfile}
            onEditProfile={profileLifecycle.openEditor}
            onManageProfiles={profileLifecycle.openManager}
            onNavigateSummary={() => navigate("track")}
            onNavigateMeasurement={navigateSummaryDetail}
            onDataChanged={profileLifecycle.refresh}
            onNotice={setMessage}
          />
        ) : null}
      </div>

      <div id="route-panel-settings" role="tabpanel" aria-labelledby={navTabIds.settings} hidden={route !== "settings"}>
        {route === "settings" ? <SettingsPage /> : null}
      </div>

      <div
        id="route-panel-import"
        role="tabpanel"
        aria-labelledby={navTabIds.import}
        hidden={route !== "import"}
      >
        {route === "import" ? (
          <ImportPage
            mode={importMode}
            onModeChange={(mode) => navigate("import", mode)}
            bootstrap={bootstrap}
            onDataChanged={profileLifecycle.refresh}
            onNotice={setMessage}
            profiles={profiles}
            activeProfileId={profile?.id}
            units={profile?.units ?? "metric"}
          />
        ) : null}
      </div>

      <div
        id="route-panel-track"
        role="tabpanel"
        aria-labelledby={navTabIds.track}
        hidden={route !== "track"}
      >
        {route === "track" ? (
          <TrackRoute
            detailCode={summaryDetailCode}
            activeProfileId={activeProfileId}
            measurementTypes={recordedMeasurementTypes}
            onBack={() => navigate("track")}
            onSelectDetail={navigateSummaryDetail}
            onDataChanged={profileLifecycle.refresh}
            onNotice={setMessage}
            confirm={confirm}
          />
        ) : null}
      </div>

      <div id="route-panel-insights" role="tabpanel" aria-labelledby={navTabIds.insights} hidden={route !== "insights"}>
        {route === "insights" ? (
          <InsightsRoute
            tab={insightsTab}
            bootstrap={bootstrap}
            onTabChange={navigateInsights}
            onDataChanged={profileLifecycle.refresh}
            onNotice={setMessage}
          />
        ) : null}
      </div>

      <div
        id="route-panel-export"
        role="tabpanel"
        aria-labelledby={navTabIds.export}
        hidden={route !== "export"}
      >
        {route === "export" ? (
          <ExportRoute bootstrap={bootstrap} onProfilesChanged={profileLifecycle.refresh} />
        ) : null}
      </div>


      <ProfileLifecycleDialogs lifecycle={profileLifecycle} />

      {/* Accessible confirmation dialog — replaces window.confirm */}
      {confirmState ? (
        <ConfirmDialog
          open={true}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          destructive={confirmState.destructive}
          onConfirm={confirmState.onConfirm}
          onCancel={confirmState.onCancel}
        />
      ) : null}

    </main>
  );
}

// ─── Routing helpers ──────────────────────────────────────────────────────────

function routeFromPathname(pathname: string): AppRoute {
  if (pathname === "/insights" || pathname.startsWith("/insights/")) return "insights";
  if (pathname === "/track" || pathname.startsWith("/track/")) return "track";
  if (pathname === "/import" || pathname.startsWith("/import/") || pathname === "/labs") return "import";
  if (pathname === "/export") return "export";
  if (pathname === "/settings") return "settings";
  return "dashboard";
}

function insightsTabFromPathname(pathname: string): InsightsTab {
  if (pathname === "/insights/ai-query") return "ai-query";
  return "biological-age";
}

function summaryDetailCodeFromPathname(pathname: string): string | undefined {
  const prefix = pathname.startsWith("/track/") ? "/track/" : undefined;
  if (!prefix) return undefined;
  const raw = pathname.slice(prefix.length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function importModeFromPathname(pathname: string): ImportMode {
  if (pathname === "/import/upload") return "upload";
  if (pathname === "/import/scan") return "scan";
  if (pathname === "/import/fitness-tracker") return "fitness";
  return "manual";
}

function importModePath(mode: ImportMode): string {
  return `/import/${mode === "fitness" ? "fitness-tracker" : mode}`;
}

function insightsPath(tab: InsightsTab): string {
  return `/insights/${tab}`;
}

function trackPath(measurementCode?: string): string {
  return measurementCode ? `/track/${encodeURIComponent(measurementCode)}` : "/track";
}

