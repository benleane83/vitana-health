import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { defaultMeasurementTypes, hasFeature } from "@vitana/shared";
import { isProfileDataCategory, type AppRoute, type CareView, type ImportMode, type InsightsTab, type ProfileDataCategory, type SettingsView, type TrackView } from "./types.js";
import { ProfileLifecycleDialogs, useProfileLifecycle } from "./features/profiles/useProfileLifecycle.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { api, setOwnerTokenPrompt } from "./api.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ImportPage } from "./pages/ImportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { InsightsRoute } from "./features/insights/InsightsRoute.js";
import { ExportRoute } from "./features/export/ExportRoute.js";
import { TrackRoute } from "./features/track/TrackRoute.js";
import { DashboardRoute } from "./features/dashboard/DashboardRoute.js";
import { CareRoute } from "./features/care/CareRoute.js";
import { AboutPage } from "./pages/AboutPage.js";
import { ProfileAvatar } from "./components/ProfileAvatar.js";
import { VitanaBrand } from "./components/VitanaBrand.js";

const routeTabs: AppRoute[] = ["dashboard", "import", "track", "care", "insights", "export", "about"];
const mainRoutes = routeTabs.slice(1);

export function App() {
  const dashboardHeaderVariant = new URLSearchParams(window.location.search).get("header") === "rail" ? "rail" : "nav";
  const [notice, setNotice] = useState<{ message: string; action?: "desktop-update" }>();
  const [route, setRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [insightsTab, setInsightsTab] = useState<InsightsTab>(() => insightsTabFromPathname(window.location.pathname));
  const [careView, setCareView] = useState(() => careViewFromPathname(window.location.pathname));
  const [selectedCareItemId, setSelectedCareItemId] = useState<string | undefined>(
    () => careItemIdFromPathname(window.location.pathname)
  );
  const [importMode, setImportMode] = useState<ImportMode>(() => importModeFromPathname(window.location.pathname));
  const [settingsView, setSettingsView] = useState<SettingsView>(() => settingsViewFromPathname(window.location.pathname));
  const [summaryDetailCode, setSummaryDetailCode] = useState<string | undefined>(
    () => summaryDetailCodeFromPathname(window.location.pathname)
  );
  const [observationGroupId, setObservationGroupId] = useState<string | undefined>(
    () => observationGroupIdFromPathname(window.location.pathname)
  );
  const [trackView, setTrackView] = useState<TrackView>(() => trackViewFromPathname(window.location.pathname));
  const [trackCategory, setTrackCategory] = useState<ProfileDataCategory | undefined>(
    () => trackCategoryFromSearch(window.location.search)
  );
  const [bodyTrendDate, setBodyTrendDate] = useState<string | undefined>(
    () => bodyTrendDateFromPathname(window.location.pathname)
  );
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const pathnameRef = useRef(locationPath());
  const startupUpdateNoticeChecked = useRef(false);
  const setMessage = (message: string | undefined) => setNotice(message ? { message } : undefined);

  // Accessible confirmation dialog state (replaces window.confirm)
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
    promptLabel?: string;
    promptType?: "text" | "password";
    onConfirm: (value: string) => void;
    onCancel: () => void;
  } | null>(null);

  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileLifecycle = useProfileLifecycle(setMessage, confirm);
  const { bootstrap, analytics, profiles, activeProfileId, profile, activeProfile } = profileLifecycle;
  const tier = profileLifecycle.entitlement?.tier ?? "free";

  const recordedMeasurementTypes = useMemo(() => {
    const measurementTypes = bootstrap?.measurementTypes?.length
      ? bootstrap.measurementTypes
      : defaultMeasurementTypes;
    return [...measurementTypes].sort((left, right) => left.display.localeCompare(right.display));
  }, [bootstrap?.measurementTypes]);

  // Popstate (browser back/forward)
  useEffect(() => {
    const onPopState = () => {
      if (pathnameRef.current !== locationPath()) {
        setMessage(undefined);
        pathnameRef.current = locationPath();
      }
      setRoute(routeFromPathname(window.location.pathname));
      setInsightsTab(insightsTabFromPathname(window.location.pathname));
      setCareView(careViewFromPathname(window.location.pathname));
      setSelectedCareItemId(careItemIdFromPathname(window.location.pathname));
      setImportMode(importModeFromPathname(window.location.pathname));
      setSettingsView(settingsViewFromPathname(window.location.pathname));
      setSummaryDetailCode(summaryDetailCodeFromPathname(window.location.pathname));
      setObservationGroupId(observationGroupIdFromPathname(window.location.pathname));
      setTrackView(trackViewFromPathname(window.location.pathname));
      setTrackCategory(trackCategoryFromSearch(window.location.search));
      setBodyTrendDate(bodyTrendDateFromPathname(window.location.pathname));
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

  useEffect(() => {
    if (route !== "dashboard" || startupUpdateNoticeChecked.current) return;
    let cancelled = false;
    let attempts = 0;
    let retryTimer: number | undefined;

    const checkForStartupUpdate = async () => {
      try {
        const update = await api.settings.updates.get();
        if (cancelled) return;
        if (update.status === "available") {
          startupUpdateNoticeChecked.current = true;
          setNotice({
            message: update.availableVersion
              ? `Version ${update.availableVersion} is available for Vitana Health.`
              : "A new version of Vitana Health is available.",
            action: "desktop-update"
          });
          return;
        }
        if (update.status !== "idle" && update.status !== "checking") {
          startupUpdateNoticeChecked.current = true;
          return;
        }
      } catch {
        if (cancelled) return;
      }

      attempts += 1;
      if (attempts < 20) retryTimer = window.setTimeout(() => { void checkForStartupUpdate(); }, 1_000);
    };

    void checkForStartupUpdate();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [route]);

  function pushPath(nextPath: string, state: Record<string, unknown> = {}) {
    if (locationPath() === nextPath) return;
    setMessage(undefined);
    window.history.pushState(state, "", nextPath);
    pathnameRef.current = nextPath;
  }

  function navigate(nextRoute: AppRoute, nextImportMode: ImportMode = importMode) {
    const routePaths: Record<AppRoute, string> = {
      dashboard: "/",
      import: importModePath(nextImportMode),
      track: trackPath(),
      care: carePath(careView),
      insights: insightsPath(insightsTab),
      export: "/export",
      about: "/about",
      settings: settingsPath(settingsView)
    };
    const nextPath = routePaths[nextRoute] ?? "/";
    pushPath(nextPath);
    if (nextRoute === "import") setImportMode(nextImportMode);
    if (nextRoute === "track") {
      setSummaryDetailCode(undefined);
      setObservationGroupId(undefined);
      setTrackView("measurements");
      setTrackCategory(undefined);
    }
    setRoute(nextRoute);
  }

  function navigateCare(nextView: CareView) {
    const nextPath = carePath(nextView);
    pushPath(nextPath);
    setCareView(nextView);
    setSelectedCareItemId(undefined);
    setRoute("care");
  }

  function navigateUpcomingCare(careItemId?: string) {
    const nextPath = carePath("items", careItemId);
    pushPath(nextPath);
    setCareView("items");
    setSelectedCareItemId(careItemId);
    setRoute("care");
  }

  function navigateInsights(nextTab: InsightsTab) {
    const nextPath = insightsPath(nextTab);
    pushPath(nextPath);
    setInsightsTab(nextTab);
    setRoute("insights");
  }

  function navigateSettings(nextView: SettingsView) {
    const nextPath = settingsPath(nextView);
    pushPath(nextPath);
    setSettingsView(nextView);
    setRoute("settings");
  }

  function navigateSummaryDetail(measurementCode: string) {
    const nextPath = trackPath(measurementCode);
    pushPath(nextPath);
    setRoute("track");
    setSummaryDetailCode(measurementCode);
    setObservationGroupId(undefined);
    setTrackView("measurements");
    setTrackCategory(undefined);
  }

  function navigateTrackView(nextView: TrackView) {
    pushPath(
      nextView === "calendar" ? "/track/calendar" : nextView === "body-trend" ? "/track/body-trend"
        : nextView === "journal" ? "/track/journal" : nextView === "panels" ? "/track/panels" : "/track"
    );
    setSummaryDetailCode(undefined);
    setObservationGroupId(undefined);
    setTrackView(nextView);
    setTrackCategory(undefined);
    setBodyTrendDate(undefined);
    setRoute("track");
  }

  function navigateBodyTrendDate(date: string) {
    pushPath(`/track/body-trend/${encodeURIComponent(date)}`);
    setSummaryDetailCode(undefined);
    setTrackView("body-trend");
    setBodyTrendDate(date);
    setRoute("track");
  }

  function navigateObservationGroup(groupId: string) {
    pushPath(`/track/groups/${encodeURIComponent(groupId)}`, { observationGroupReturnPath: window.location.pathname });
    setSummaryDetailCode(undefined);
    setObservationGroupId(groupId);
    setTrackView(trackView);
    setTrackCategory(undefined);
    setRoute("track");
  }

  function navigateTrackCategory(category?: ProfileDataCategory) {
    pushPath(trackPath(undefined, category));
    setSummaryDetailCode(undefined);
    setObservationGroupId(undefined);
    setTrackView("measurements");
    setTrackCategory(category);
    setRoute("track");
  }

  function navigateCategoryImport(category: ProfileDataCategory, mode: Extract<ImportMode, "manual" | "upload">) {
    pushPath(importModePath(mode, category));
    setImportMode(mode);
    setRoute("import");
  }

  function navigateBackFromObservationGroup() {
    if (typeof window.history.state?.observationGroupReturnPath === "string") {
      window.history.back();
      return;
    }
    navigateTrackView(trackView);
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

  // Route the API layer's owner-token fallback through the accessible dialog instead of
  // window.prompt, which blocks the renderer and cannot mask the token.
  useEffect(() => {
    setOwnerTokenPrompt(() => new Promise<string | null>((resolve) => {
      setConfirmState({
        title: "Automatic sign-in unavailable",
        description: "Cancel and reopen Vitana Health to retry automatic sign-in. Manual token entry is available for development and recovery.",
        confirmLabel: "Continue",
        destructive: false,
        promptLabel: "Owner token",
        promptType: "password",
        onConfirm: (value) => {
          setConfirmState(null);
          resolve(value.trim() || null);
        },
        onCancel: () => {
          setConfirmState(null);
          resolve(null);
        }
      });
    }));
    return () => setOwnerTokenPrompt(undefined);
  }, []);

  // ─── Navigation tabs ─────────────────────────────────────────────────────────

  const navTabIds: Record<AppRoute, string> = {
    dashboard: "nav-tab-dashboard",
    import: "nav-tab-import",
    track: "nav-tab-track",
    care: "nav-tab-care",
    insights: "nav-tab-insights",
    export: "nav-tab-export",
    about: "nav-tab-about",
    settings: "nav-tab-settings"
  };

  function handleRouteTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentRoute: AppRoute) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = routeTabs.indexOf(currentRoute);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? routeTabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + routeTabs.length) % routeTabs.length;
    const nextRoute = routeTabs[nextIndex];
    setProfileMenuOpen(false);
    navigate(nextRoute);
    document.getElementById(navTabIds[nextRoute])?.focus();
  }

  return (
    <main className="shell">
      <header className="shell-navigation">
        {dashboardHeaderVariant === "rail" ? <VitanaBrand variant="rail" /> : null}
        {/* Navigation tablist */}
        <nav className={`route-nav route-nav-${dashboardHeaderVariant}`} aria-label="Page navigation">
        <div className="route-nav-main" role="tablist" aria-label="App sections">
          <VitanaBrand
            variant="nav"
            id={navTabIds.dashboard}
            active={route === "dashboard"}
            onClick={() => {
              setProfileMenuOpen(false);
              navigate("dashboard");
            }}
            onKeyDown={(event) => handleRouteTabKeyDown(event, "dashboard")}
          />
          {mainRoutes.map((r) => {
            const labels: Record<AppRoute, string> = {
              dashboard: "Dashboard",
              import: "Import",
              track: "Track",
              care: "Care",
              insights: "Insights",
              export: "Export",
              about: "About",
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
              profileId={activeProfileId}
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
                    profileId={entry.id}
                    revision={entry.profilePhoto?.revision}
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
      </header>

      <div className="shell-content">
        {/* Global status/notice — live region */}
        {notice ? (
          <div className="notice">
            <span className="notice-message" role="status" aria-live="polite" aria-atomic="true">
              {notice.message}
            </span>
            {notice.action === "desktop-update" ? (
              <a
                className="notice-action"
                href="/settings/app"
                onClick={(event) => {
                  event.preventDefault();
                  setNotice(undefined);
                  navigateSettings("app");
                }}
              >
                Open App Settings
              </a>
            ) : null}
            <button
              className="notice-dismiss"
              type="button"
              aria-label="Dismiss notification"
              title="Dismiss notification"
              onClick={() => setNotice(undefined)}
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
              onNavigateCategory={navigateTrackCategory}
              onNavigateCare={navigateUpcomingCare}
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
              category={importCategoryFromSearch(window.location.search)}
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
              observationGroupId={observationGroupId}
              view={trackView}
              activeProfileId={activeProfileId}
              measurementTypes={recordedMeasurementTypes}
              units={profile?.units ?? "metric"}
              latestMetrics={analytics?.latestMetrics ?? []}
              onViewChange={navigateTrackView}
              bodyTrendDate={bodyTrendDate}
              onSelectBodyTrendDate={navigateBodyTrendDate}
              onBack={navigateBackFromObservationGroup}
              onSelectDetail={navigateSummaryDetail}
              onViewObservationGroup={navigateObservationGroup}
              onDataChanged={() => profileLifecycle.refresh({ profiles: false })}
              onNotice={setMessage}
              confirm={confirm}
              calendarAllowed={hasFeature(tier, "track-calendar")}
              bodyTrendAllowed={hasFeature(tier, "track-body-trend")}
              categoryFilter={trackCategory}
              onClearCategoryFilter={() => navigateTrackCategory()}
              onAddCategory={navigateCategoryImport}
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
              selectedCareItemId={selectedCareItemId}
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
              aiQueryAllowed={hasFeature(tier, "ai-query")}
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

        <div id="route-panel-about" role="tabpanel" aria-labelledby={navTabIds.about} hidden={route !== "about"}>
          {route === "about" ? (
            <ErrorBoundary label="About">
              <AboutPage />
            </ErrorBoundary>
          ) : null}
        </div>
      </div>


      <ProfileLifecycleDialogs
        lifecycle={profileLifecycle}
        allowProfileCreation={profiles.length === 0 || hasFeature(tier, "additional-profile-creation")}
      />

      {/* Accessible confirmation dialog — replaces window.confirm */}
      {confirmState ? (
        <ConfirmDialog
          open={true}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          destructive={confirmState.destructive}
          promptLabel={confirmState.promptLabel}
          promptType={confirmState.promptType}
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
  if (pathname === "/about") return "about";
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

function careViewFromPathname(pathname: string): CareView {
  if (pathname === "/care/health-events") return "health-events";
  if (pathname === "/care/medications") return "medications";
  return "items";
}

function summaryDetailCodeFromPathname(pathname: string): string | undefined {
  const prefix = pathname.startsWith("/track/") ? "/track/" : undefined;
  if (!prefix) return undefined;
  const raw = pathname.slice(prefix.length);
  if (!raw || raw === "calendar" || raw === "body-trend" || raw === "journal" || raw === "groups" || raw.startsWith("groups/") || raw.startsWith("body-trend/")) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function observationGroupIdFromPathname(pathname: string): string | undefined {
  const prefix = "/track/groups/";
  if (!pathname.startsWith(prefix)) return undefined;
  const raw = pathname.slice(prefix.length);
  if (!raw || raw.includes("/")) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function bodyTrendDateFromPathname(pathname: string): string | undefined {
  const match = /^\/track\/body-trend\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
  return match?.[1];
}

function trackViewFromPathname(pathname: string): TrackView {
  return pathname === "/track/calendar" || pathname.startsWith("/track/calendar/")
    ? "calendar"
    : pathname === "/track/body-trend" || bodyTrendDateFromPathname(pathname)
      ? "body-trend"
      : pathname === "/track/journal" || pathname.startsWith("/track/journal/")
        ? "journal"
        : pathname === "/track/panels"
          ? "panels"
          : "measurements";
}

function importModeFromPathname(pathname: string): ImportMode {
  if (pathname === "/import/upload") return "upload";
  if (pathname === "/import/sync") return "sync";
  return "manual";
}

function importModePath(mode: ImportMode, category?: ProfileDataCategory): string {
  const path = `/import/${mode}`;
  return category ? `${path}?category=${encodeURIComponent(category)}` : path;
}

function insightsPath(tab: InsightsTab): string {
  return `/insights/${tab}`;
}

function trackPath(measurementCode?: string, category?: ProfileDataCategory): string {
  const path = measurementCode ? `/track/${encodeURIComponent(measurementCode)}` : "/track";
  return category ? `${path}?category=${encodeURIComponent(category)}` : path;
}

function trackCategoryFromSearch(search: string): ProfileDataCategory | undefined {
  const category = new URLSearchParams(search).get("category");
  return isProfileDataCategory(category) ? category : undefined;
}

function importCategoryFromSearch(search: string): ProfileDataCategory | undefined {
  const category = new URLSearchParams(search).get("category");
  return isProfileDataCategory(category) ? category : undefined;
}

function locationPath(): string {
  return window.location.pathname + window.location.search;
}

function carePath(view: CareView, careItemId?: string): string {
  if (view === "health-events") return "/care/health-events";
  if (view === "medications") return "/care/medications";
  return careItemId ? `/care/items/${encodeURIComponent(careItemId)}` : "/care/items";
}

function careItemIdFromPathname(pathname: string): string | undefined {
  const prefix = "/care/items/";
  if (!pathname.startsWith(prefix)) return undefined;
  const raw = pathname.slice(prefix.length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
