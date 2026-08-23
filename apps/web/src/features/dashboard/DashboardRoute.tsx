import { useEffect, useState } from "react";
import type { AnalyticsSummary, CareItem, HealthDataSummary, Profile } from "@vitana/shared";
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
  onNavigateCategory,
  onNavigateCare
}: {
  analytics?: AnalyticsSummary;
  profile?: Profile;
  onEditProfile: () => void;
  onNavigateSummary: () => void;
  onNavigateMeasurement: (measurementCode: string) => void;
  onNavigateCategory: (category: import("../../types.js").ProfileDataCategory) => void;
  onNavigateCare: (careItemId?: string) => void;
}) {
  const [upcomingCare, setUpcomingCare] = useState<UpcomingCareState>({ items: [], total: 0, busy: true });
  const [summary, setSummary] = useState<HealthDataSummary>();
  const [summaryError, setSummaryError] = useState<string>();

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

  useEffect(() => {
    const controller = new AbortController();
    setSummaryError(undefined);
    void api.summary(controller.signal).then((data) => {
      if (!controller.signal.aborted) setSummary(data);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setSummary(undefined);
        setSummaryError(error instanceof Error ? error.message : "Unable to load profile summary.");
      }
    });
    return () => controller.abort();
  }, [profile?.id]);

  return (
    <DashboardPage
      analytics={analytics}
      summary={summary}
      summaryError={summaryError}
      profile={profile}
      upcomingCare={upcomingCare}
      onEditProfile={onEditProfile}
      onNavigateSummary={onNavigateSummary}
      onNavigateMeasurement={onNavigateMeasurement}
      onNavigateCategory={onNavigateCategory}
      onNavigateCare={onNavigateCare}
      onRetryUpcomingCare={() => { void loadUpcomingCare(); }}
    />
  );
}
