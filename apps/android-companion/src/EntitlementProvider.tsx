import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  InactiveEntitlementService,
  PURCHASE_GATING_ENABLED,
  StoreEntitlementService,
  createEntitlementStore,
  type EntitlementService,
  type EntitlementState
} from "./entitlementService";
import { createStoreBillingClient } from "./storeBillingClient";

interface EntitlementContextValue {
  state: EntitlementState;
  purchase(): Promise<void>;
  restore(): Promise<void>;
}

const EntitlementContext = createContext<EntitlementContextValue | undefined>(undefined);

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const service = useMemo<EntitlementService>(
    () => PURCHASE_GATING_ENABLED
      ? new StoreEntitlementService(createStoreBillingClient(), createEntitlementStore())
      : new InactiveEntitlementService(),
    []
  );
  const [state, setState] = useState(service.getState());

  useEffect(() => {
    const unsubscribe = service.subscribe(setState);
    void service.initialize();
    return () => {
      unsubscribe();
      void service.close();
    };
  }, [service]);

  const value = useMemo<EntitlementContextValue>(() => ({
    state,
    purchase: () => service.purchase(),
    restore: () => service.restore()
  }), [service, state]);

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementContextValue {
  const value = useContext(EntitlementContext);
  if (!value) throw new Error("useEntitlement must be used inside EntitlementProvider.");
  return value;
}
