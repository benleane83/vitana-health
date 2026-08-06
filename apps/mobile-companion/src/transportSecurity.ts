export interface TransportSecurityContext {
  /** `__DEV__` — true only when the JavaScript bundle is served by Metro. */
  isDevelopmentBuild: boolean;
  /** `extra.allowCleartext` from the compiled app config. */
  allowCleartext: boolean;
}

/**
 * Cleartext HTTP is only ever acceptable while a developer is pointing the app at an unencrypted
 * local API. Whether it is enabled is decided at build time by three switches that have to agree:
 * `android.usesCleartextTraffic`, the generated network security config, and the `__DEV__` guards in
 * syncHealthConnect and PairScreen. Nothing tied those together, so a release build compiled with
 * the development environment still selected would downgrade its own transport silently — health
 * data on a shared network with no visible symptom.
 *
 * app.config.js rejects that combination for any distributable EAS profile. This is the second
 * layer, and it catches the case that check cannot see: a release build produced outside EAS. It
 * runs during render inside the error boundary, so the failure surfaces as a readable screen rather
 * than a blank one.
 */
export function assertTransportSecurity({
  isDevelopmentBuild,
  allowCleartext
}: TransportSecurityContext): void {
  if (isDevelopmentBuild || !allowCleartext) {
    return;
  }
  throw new Error(
    "This is a release build with cleartext HTTP enabled, which would send health data over an " +
    "unencrypted connection. Rebuild without VITANA_ALLOW_CLEARTEXT=1, or install a development build."
  );
}
