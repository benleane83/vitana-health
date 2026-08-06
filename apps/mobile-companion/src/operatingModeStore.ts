import AsyncStorage from "@react-native-async-storage/async-storage";

const OPERATING_MODE_KEY = "vitana.operatingMode";

export type CompanionOperatingMode = "standalone" | "connected";

export async function loadOperatingMode(): Promise<CompanionOperatingMode | null> {
  const stored = await AsyncStorage.getItem(OPERATING_MODE_KEY);
  return stored === "standalone" || stored === "connected" ? stored : null;
}

export async function saveOperatingMode(mode: CompanionOperatingMode): Promise<void> {
  await AsyncStorage.setItem(OPERATING_MODE_KEY, mode);
}

export function resolveOperatingMode(
  stored: CompanionOperatingMode | null,
  hasPairedConnection: boolean
): CompanionOperatingMode {
  if (!hasPairedConnection) return "standalone";
  return stored ?? "connected";
}

export function shouldCreateStandaloneSource(
  preferencesLoaded: boolean,
  operatingMode: CompanionOperatingMode,
  demoMode: boolean
): boolean {
  return preferencesLoaded && operatingMode === "standalone" && !demoMode;
}