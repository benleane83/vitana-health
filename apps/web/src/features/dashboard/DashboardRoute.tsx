import type { AnalyticsSummary, Profile } from "@vitana/shared";
import { DashboardPage } from "../../pages/DashboardPage.js";

export function DashboardRoute({
  analytics,
  profile,
  onEditProfile,
  onNavigateSummary,
  onNavigateMeasurement
}: {
  analytics?: AnalyticsSummary;
  profile?: Profile;
  onEditProfile: () => void;
  onNavigateSummary: () => void;
  onNavigateMeasurement: (measurementCode: string) => void;
}) {
  return (
    <DashboardPage
      analytics={analytics}
      profile={profile}
      onEditProfile={onEditProfile}
      onNavigateSummary={onNavigateSummary}
      onNavigateMeasurement={onNavigateMeasurement}
    />
  );
}
