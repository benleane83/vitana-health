import { useState } from "react";
import type { AnalyticsSummary, AppBootstrap, Profile } from "@vitana/shared";
import { api } from "../../api.js";
import { DashboardPage } from "../../pages/DashboardPage.js";

export function DashboardRoute({
  bootstrap,
  analytics,
  profile,
  onEditProfile,
  onNavigateSummary,
  onNavigateMeasurement,
  onDataChanged,
  onNotice
}: {
  bootstrap?: AppBootstrap;
  analytics?: AnalyticsSummary;
  profile?: Profile;
  onEditProfile: () => void;
  onNavigateSummary: () => void;
  onNavigateMeasurement: (measurementCode: string) => void;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

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
      analytics={analytics}
      busy={busy}
      latestInsight={bootstrap?.latestInsight}
      profile={profile}
      onEditProfile={onEditProfile}
      onNavigateSummary={onNavigateSummary}
      onNavigateMeasurement={onNavigateMeasurement}
      onGenerateInsight={() => { void generateInsight(); }}
    />
  );
}