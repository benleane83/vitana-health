import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { defaultMeasurementTypes, safetyNotice } from "@vitana/shared";
import type { AppRoute, ImportMode, InsightsTab, SettingsView } from "./types.js";
import { ProfileLifecycleDialogs, useProfileLifecycle } from "./features/profiles/useProfileLifecycle.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ImportPage } from "./pages/ImportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { InsightsRoute } from "./features/insights/InsightsRoute.js";
import { ExportRoute } from "./features/export/ExportRoute.js";
import { TrackRoute } from "./features/track/TrackRoute.js";
import { DashboardRoute } from "./features/dashboard/DashboardRoute.js";
import { CareRoute } from "./features/care/CareRoute.js";
import { ProfileAvatar } from "./components/ProfileAvatar.js";
import { VitanaBrand } from "./components/VitanaBrand.js";

const mainRoutes: AppRoute[] = ["dashboard", "import", "track", "care", "insights", "export"];

export function App() {
  const dashboardHeaderVariant = new URLSearchParams(window.location.search).get("header") === "rail" ? "rail" : "nav";
  const [message, setMessage] = useState<string>();
  const [route, setRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [insightsTab, setInsightsTab] = useState<InsightsTab>(() => insightsTabFromPathname(window.location.pathname));
  const [careView, setCareView] = useState(() => careViewFromPathname(window.location.pathname));
  const [importMode, setImportMode] = useState<ImportMode>(() => importModeFromPathname(window.location.pathname));
  const [settingsView, setSettingsView] = useState<SettingsView>(() => settingsViewFromPathname(window.location.pathname));
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
      normalizeLegacyImportPath();
      setRoute(routeFromPathname(window.location.pathname));
      setInsightsTab(insightsTabFromPathname(window.location.pathname));
      setCareView(careViewFromPathname(window.location.pathname));
      setImportMode(importModeFromPathname(window.location.pathname));
      setSettingsView(settingsViewFromPathname(window.location.pathname));
      setSummaryDetailCode(summaryDetailCodeFromPathname(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Normalize legacy /import/scan and /import/fitness-tracker URLs to their
  // canonical /import/upload and /import/sync form without adding a history entry.
  useEffect(() => {
    normalizeLegacyImportPath();
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
      care: carePath(careView),
      insights: insightsPath(insightsTab),
      export: "/export",
      settings: settingsPath(settingsView)
    };
    const nextPath = routePaths[nextRoute] ?? "/";
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    if (nextRoute === "import") setImportMode(nextImportMode);
    if (nextRoute === "track") setSummaryDetailCode(undefined);
    setRoute(nextRoute);
  }

  function navigateCare(nextView: "items" | "health-events") {
    const nextPath = carePath(nextView);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setCareView(nextView);
    setRoute("care");
  }

  function navigateInsights(nextTab: InsightsTab) {
    const nextPath = insightsPath(nextTab);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setInsightsTab(nextTab);
    setRoute("insights");
  }

  function navigateSettings(nextView: SettingsView) {
    const nextPath = settingsPath(nextView);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setSettingsView(nextView);
    setRoute("settings");
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
    care: "nav-tab-care",
    insights: "nav-tab-insights",
    export: "nav-tab-export",
    settings: "nav-tab-settings"
  };

  function handleRouteTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentRoute: AppRoute) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = mainRoutes.indexOf(currentRoute);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? mainRoutes.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + mainRoutes.length) % mainRoutes.length;
    const nextRoute = mainRoutes[nextIndex];
    setProfileMenuOpen(false);
    navigate(nextRoute);
    document.getElementById(navTabIds[nextRoute])?.focus();
  }

  return (
    <main className="shell">
      {dashboardHeaderVariant === "rail" ? <VitanaBrand variant="rail" /> : null}
      {/* Navigation tablist */}
      <nav className={`route-nav route-nav-${dashboardHeaderVariant}`} aria-label="Page navigation">
        {dashboardHeaderVariant === "nav" ? <VitanaBrand variant="nav" /> : null}
        <div className="route-nav-main" role="tablist" aria-label="App sections">
          {mainRoutes.map((r) => {
            const labels: Record<AppRoute, string> = {
              dashboard: "Dashboard",
              import: "Import",
              track: "Track",
              care: "Care",
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
                onKeyDown={(event) => handleRouteTabKeyDown(event, r)}
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
            <ProfileAvatar
              compact
              displayName={activeProfile?.displayName ?? "Profile"}
              revision={bootstrap?.profilePhoto?.revision}
            />
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
                  <ProfileAvatar
                    compact
                    displayName={entry.displayName}
                    revision={entry.id === activeProfileId ? entry.profilePhoto?.revision : undefined}
                  />
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
          <ErrorBoundary label="Dashboard">
            <DashboardRoute
              analytics={analytics}
              profile={profile}
              onEditProfile={profileLifecycle.openEditor}
              onNavigateSummary={() => navigate("track")}
              onNavigateMeasurement={navigateSummaryDetail}
            />
          </ErrorBoundary>
        ) : null}
      </div>

      <div id="route-panel-settings" role="tabpanel" aria-labelledby={navTabIds.settings} hidden={route !== "settings"}>
        {route === "settings" ? (
          <ErrorBoundary label="Settings">
            <SettingsPage view={settingsView} onViewChange={navigateSettings} confirm={confirm} />
          </ErrorBoundary>
        ) : null}
      </div>

      <div
        id="route-panel-import"
        role="tabpanel"
        aria-labelledby={navTabIds.import}
        hidden={route !== "import"}
      >
        {route === "import" ? (
          <ErrorBoundary label="Import">
            <ImportPage
              mode={importMode}
              onModeChange={(mode) => navigate("import", mode)}
              bootstrap={bootstrap}
              onDataChanged={() => profileLifecycle.refresh({ profiles: false })}
              onNotice={setMessage}
              profiles={profiles}
              activeProfileId={profile?.id}
              units={profile?.units ?? "metric"}
            />
          </ErrorBoundary>
        ) : null}
      </div>

      <div
        id="route-panel-track"
        role="tabpanel"
        aria-labelledby={navTabIds.track}
        hidden={route !== "track"}
      >
        {route === "track" ? (
          <ErrorBoundary label="Track">
            <TrackRoute
              detailCode={summaryDetailCode}
              activeProfileId={activeProfileId}
              measurementTypes={recordedMeasurementTypes}
              onBack={() => navigate("track")}
              onSelectDetail={navigateSummaryDetail}
              onDataChanged={() => profileLifecycle.refresh({ profiles: false })}
              onNotice={setMessage}
              confirm={confirm}
            />
          </ErrorBoundary>
        ) : null}
      </div>

      <div id="route-panel-care" role="tabpanel" aria-labelledby={navTabIds.care} hidden={route !== "care"}>
        {route === "care" ? (
          <ErrorBoundary label="Care">
            <CareRoute
              view={careView}
              activeProfileId={activeProfileId}
              onViewChange={navigateCare}
              onDataChanged={() => profileLifecycle.refresh({ profiles: false })}
              onNotice={setMessage}
              confirm={confirm}
            />
          </ErrorBoundary>
        ) : null}
      </div>

      <div id="route-panel-insights" role="tabpanel" aria-labelledby={navTabIds.insights} hidden={route !== "insights"}>
        {route === "insights" ? (
          <ErrorBoundary label="Insights">
            <InsightsRoute
              tab={insightsTab}
              bootstrap={bootstrap}
              onTabChange={navigateInsights}
              onDataChanged={() => profileLifecycle.refresh({ profiles: false })}
              onNotice={setMessage}
            />
          </ErrorBoundary>
        ) : null}
      </div>

      <div
        id="route-panel-export"
        role="tabpanel"
        aria-labelledby={navTabIds.export}
        hidden={route !== "export"}
      >
        {route === "export" ? (
          <ErrorBoundary label="Export">
            <ExportRoute bootstrap={bootstrap} onProfilesChanged={profileLifecycle.refresh} />
          </ErrorBoundary>
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
  if (pathname === "/care" || pathname.startsWith("/care/")) return "care";
  if (pathname === "/import" || pathname.startsWith("/import/") || pathname === "/labs") return "import";
  if (pathname === "/export") return "export";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  return "dashboard";
}

function settingsViewFromPathname(pathname: string): SettingsView {
  return pathname === "/settings/ai" ? "ai" : "app";
}

function settingsPath(view: SettingsView): string {
  return `/settings/${view}`;
}

function insightsTabFromPathname(pathname: string): InsightsTab {
  if (pathname === "/insights/ai-query") return "ai-query";
  if (pathname === "/insights/ai-review") return "ai-review";
  return "biological-age";
}

function careViewFromPathname(pathname: string): "items" | "health-events" {
  if (pathname === "/care/health-events") return "health-events";
  return "items";
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

// Canonical import mode routes are /import/upload and /import/sync. Earlier
// prototypes used /import/scan and /import/fitness-tracker; those are
// recognized here and normalized to the canonical path via history.replaceState
// (see normalizeLegacyImportPath) rather than being treated as first-class routes.
const legacyImportPathAliases: Partial<Record<string, ImportMode>> = {
  "/import/scan": "upload",
  "/import/fitness-tracker": "sync"
};

function importModeFromPathname(pathname: string): ImportMode {
  if (pathname === "/import/upload") return "upload";
  if (pathname === "/import/sync") return "sync";
  return legacyImportPathAliases[pathname] ?? "manual";
}

function importModePath(mode: ImportMode): string {
  return `/import/${mode}`;
}

function canonicalImportPathname(pathname: string): string | undefined {
  const alias = legacyImportPathAliases[pathname];
  return alias ? importModePath(alias) : undefined;
}

function normalizeLegacyImportPath(): void {
  const canonical = canonicalImportPathname(window.location.pathname);
  if (canonical && canonical !== window.location.pathname) {
    window.history.replaceState({}, "", canonical);
  }
}

function insightsPath(tab: InsightsTab): string {
  return `/insights/${tab}`;
}

function trackPath(measurementCode?: string): string {
  return measurementCode ? `/track/${encodeURIComponent(measurementCode)}` : "/track";
}

function carePath(view: "items" | "health-events"): string {
  return view === "health-events" ? "/care/health-events" : "/care/items";
}
