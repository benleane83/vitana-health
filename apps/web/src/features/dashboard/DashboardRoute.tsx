import { useState } from "react";
import type { AnalyticsSummary, AppBootstrap, CloudAiConsent, Profile } from "@vitana/shared";
import { api } from "../../api.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
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
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);

  async function generateInsight() {
    setBusy(true);
    try {
      const config = await api.llm.config();
      const consent = bootstrap?.profile.cloudAiConsent;
      const cloudEnabled = consent?.enabled === true && consent.providerScopeAccepted === true;
      if (config.provider === "openai" && !cloudEnabled) {
        setConsentDialogOpen(true);
        return;
      }
      await api.generateInsight();
      await onDataChanged();
      onNotice("Insight generated from local data.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptCloudConsent() {
    setConsentDialogOpen(false);
    setBusy(true);
    try {
      const consent: CloudAiConsent = {
        enabled: true,
        providerScopeAccepted: true,
        consentVersion: "v1"
      };
      await api.cloudAiConsent.set(consent);
      await api.generateInsight();
      await onDataChanged();
      onNotice("Insight generated using the configured AI model.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not enable cloud AI insights.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
      <ConfirmDialog
        open={consentDialogOpen}
        title="Allow cloud AI insights?"
        description="Vitana will send the anonymized health data needed for this review to your configured cloud AI provider. You can disable cloud prompts later in Insights."
        cancelLabel="Not now"
        confirmLabel="Allow and generate"
        onConfirm={() => { void acceptCloudConsent(); }}
        onCancel={() => setConsentDialogOpen(false)}
      />
    </>
  );
}
