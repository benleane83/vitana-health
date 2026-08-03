import { useEffect, useState } from "react";
import type { AnalyticsSummary, CareItem, Profile } from "@vitana/shared";
import { api } from "../../api.js";
import { DashboardPage } from "../../pages/DashboardPage.js";

type UpcomingCareState = {
  items: CareItem[];
  total: number;
  busy: boolean;
  error?: string;
};

function dueWithinThirtyDays(now = new Date()): string {
  const dueTo = new Date(now);
  dueTo.setDate(dueTo.getDate() + 30);
  return dueTo.toISOString();
}

export function DashboardRoute({
  analytics,
  profile,
  onEditProfile,
  onNavigateSummary,
  onNavigateMeasurement,
  onNavigateCare
}: {
  analytics?: AnalyticsSummary;
  profile?: Profile;
  onEditProfile: () => void;
  onNavigateSummary: () => void;
  onNavigateMeasurement: (measurementCode: string) => void;
  onNavigateCare: (careItemId?: string) => void;
}) {
  const [upcomingCare, setUpcomingCare] = useState<UpcomingCareState>({ items: [], total: 0, busy: true });

  async function loadUpcomingCare() {
    setUpcomingCare((current) => ({ ...current, busy: true, error: undefined }));
    try {
      const result = await api.care.listCareItems({
        status: "open",
        dueTo: dueWithinThirtyDays(),
        limit: 3,
        offset: 0
      });
      setUpcomingCare({ items: result.items, total: result.total, busy: false });
    } catch (error) {
      setUpcomingCare((current) => ({
        ...current,
        busy: false,
        error: error instanceof Error ? error.message : "Unable to load upcoming care."
      }));
    }
  }

  useEffect(() => {
    void loadUpcomingCare();
  }, [profile?.id]);

  return (
    <DashboardPage
      analytics={analytics}
      profile={profile}
      upcomingCare={upcomingCare}
      onEditProfile={onEditProfile}
      onNavigateSummary={onNavigateSummary}
      onNavigateMeasurement={onNavigateMeasurement}
      onNavigateCare={onNavigateCare}
      onRetryUpcomingCare={() => { void loadUpcomingCare(); }}
    />
  );
}
