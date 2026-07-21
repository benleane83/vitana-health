import AsyncStorage from "@react-native-async-storage/async-storage";

const DEMO_MODE_KEY = "vitana.demoMode";

export async function loadDemoMode(): Promise<boolean> {
  if (process.env.EXPO_PUBLIC_VITANA_DEMO_MODE === "1") return true;
  return (await AsyncStorage.getItem(DEMO_MODE_KEY)) === "true";
}

export async function saveDemoMode(enabled: boolean): Promise<void> {
  if (enabled) await AsyncStorage.setItem(DEMO_MODE_KEY, "true");
  else await AsyncStorage.removeItem(DEMO_MODE_KEY);
}