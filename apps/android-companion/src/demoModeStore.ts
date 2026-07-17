import AsyncStorage from "@react-native-async-storage/async-storage";

const DEMO_MODE_KEY = "local-fitness-advisor.demoMode";

export async function loadDemoMode(): Promise<boolean> {
  return (await AsyncStorage.getItem(DEMO_MODE_KEY)) === "true";
}

export async function saveDemoMode(enabled: boolean): Promise<void> {
  if (enabled) await AsyncStorage.setItem(DEMO_MODE_KEY, "true");
  else await AsyncStorage.removeItem(DEMO_MODE_KEY);
}