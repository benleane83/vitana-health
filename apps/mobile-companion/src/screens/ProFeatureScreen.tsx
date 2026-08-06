import type { ReactNode } from "react";
import { hasFeature, type ProFeature } from "@vitana/shared";
import { useEntitlement } from "../EntitlementProvider";
import { Message, Screen } from "../ui/components";

export function ProFeatureScreen({ children, feature, label }: {
  children: ReactNode;
  feature: ProFeature;
  label: string;
}) {
  const { state } = useEntitlement();
  if (hasFeature(state.tier, feature, true)) return children;

  return (
    <Screen>
      <Message
        title={`${label} is available in Vitana Pro`}
        detail="Upgrade to Vitana Pro to use this view."
        tone="info"
      />
    </Screen>
  );
}