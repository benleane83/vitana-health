import { useMemo, useState } from "react";
import type { AnalyticsSummary, AppBootstrap, Profile, ProfileListEntry } from "@local-fitness-advisor/shared";
import { api } from "../../api.js";
import { DashboardPage } from "../../pages/DashboardPage.js";

export function DashboardRoute({
  bootstrap,
  analytics,
  profile,
  activeProfile,
  onEditProfile,
  onManageProfiles,
  onNavigateSummary,
  onNavigateMeasurement,
  onDataChanged,
  onNotice
}: {
  bootstrap?: AppBootstrap;
  analytics?: AnalyticsSummary;
  profile?: Profile;
  activeProfile?: ProfileListEntry | Profile;
  onEditProfile: () => void;
  onManageProfiles: () => void;
  onNavigateSummary: () => void;
  onNavigateMeasurement: (measurementCode: string) => void;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const density = useMemo(() => {
    const counts = analytics?.counts;
    if (!counts) return 0;
    return Math.min(100, counts.observations + counts.samples / 10 + counts.activities * 4);
  }, [analytics]);

  async function generateInsight() {
    setBusy(true);
    try {
      await api.generateInsight();
      await onDataChanged();
      onNotice("Insight generated from local data.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardPage
      importCount={bootstrap?.counts.imports ?? 0}
      analytics={analytics}
      density={density}
      busy={busy}
      latestInsight={bootstrap?.latestInsight}
      profile={profile}
      activeProfile={activeProfile}
      onEditProfile={onEditProfile}
      onManageProfiles={onManageProfiles}
      onNavigateSummary={onNavigateSummary}
      onNavigateMeasurement={onNavigateMeasurement}
      onGenerateInsight={() => { void generateInsight(); }}
    />
  );
}