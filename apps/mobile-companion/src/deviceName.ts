export function companionDeviceName(platform: string): string {
  return platform === "ios" ? "iOS Companion" : "Android Companion";
}