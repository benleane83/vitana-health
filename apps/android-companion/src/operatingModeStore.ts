import AsyncStorage from "@react-native-async-storage/async-storage";

const OPERATING_MODE_KEY = "local-fitness-advisor.operatingMode";

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
  return stored ?? (hasPairedConnection ? "connected" : "standalone");
}