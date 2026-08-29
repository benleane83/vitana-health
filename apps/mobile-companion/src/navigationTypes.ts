export type RootStackParamList = {
  Main: undefined;
  Pair: { app?: string; url?: string; pairingCode?: string; publicKeyHash?: string } | undefined;
  Connection: { activatePairing?: boolean } | undefined;
  License: undefined;
  TrackMetrics: undefined;
  TrackJournal: undefined;
  TrackCalendar: undefined;
  TrackBodyTrend: undefined;
  TrackDetail: { measurementCode: string; displayName: string };
  ObservationGroup: { groupId: string; label: string };
};

export type TabParamList = {
  Dashboard: undefined;
  Import: undefined;
  Track: undefined;
  Care: {
    view?: "items" | "health-events" | "medications";
    editCareItemId?: string;
  } | undefined;
};
