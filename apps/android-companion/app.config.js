const allowCleartext = process.env.VITANA_ALLOW_CLEARTEXT === "1";
const buildProfile = process.env.EAS_BUILD_PROFILE || null;

// Cleartext HTTP is a development affordance: it lets the companion talk to an unencrypted local
// API while the pairing certificate work is bypassed. Three independent switches have to agree for
// that to be safe (`usesCleartextTraffic`, the network security config, and the `__DEV__` guards in
// syncHealthConnect/PairScreen), and nothing previously stopped a distributable profile from being
// built with the development environment still selected. `development` is the only EAS profile that
// may carry it; every other profile produces an artifact that can reach a tester, so fail the build
// rather than ship one that will silently downgrade its own transport.
// `buildProfile` is unset for a local `expo start`, which is not a distributable artifact — the
// startup assertion in src/transportSecurity.ts covers a locally compiled release build instead.
if (allowCleartext && buildProfile && buildProfile !== "development") {
  throw new Error(
    `EAS profile "${buildProfile}" was built with VITANA_ALLOW_CLEARTEXT=1. Cleartext HTTP is only ` +
    "permitted on the \"development\" profile. Fix the profile's env block in eas.json, or build the " +
    "development profile instead."
  );
}

module.exports = {
  expo: {
    name: "Vitana",
    slug: "local-fitness-companion",
    version: "0.1.2",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    android: {
      package: "app.vitanahealth",
      allowBackup: false,
      usesCleartextTraffic: allowCleartext,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.health.READ_STEPS",
        "android.permission.health.READ_HEART_RATE",
        "android.permission.health.READ_RESTING_HEART_RATE",
        "android.permission.health.READ_OXYGEN_SATURATION",
        "android.permission.health.READ_HEART_RATE_VARIABILITY",
        "android.permission.health.READ_RESPIRATORY_RATE",
        "android.permission.health.READ_BASAL_METABOLIC_RATE",
        "android.permission.health.READ_HEIGHT",
        "android.permission.health.READ_VO2_MAX",
        "android.permission.health.READ_WEIGHT",
        "android.permission.health.READ_DISTANCE",
        "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
        "android.permission.health.READ_TOTAL_CALORIES_BURNED",
        "android.permission.health.READ_SLEEP",
        "android.permission.health.READ_BODY_FAT",
        "android.permission.health.READ_EXERCISE",
        "android.permission.health.READ_HEALTH_DATA_HISTORY"
      ],
      adaptiveIcon: {
        backgroundColor: "#E7EDFF",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png"
      },
      predictiveBackGestureEnabled: false
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    // iOS is not shipped yet. This block exists so `expo run:ios` and `eas build -p ios` fail on
    // real, nameable problems (a missing native module, an unsigned capability) instead of on a
    // missing bundle identifier, which tells us nothing about how far the port actually is.
    ios: {
      bundleIdentifier: "app.vitanahealth",
      supportsTablet: true,
      infoPlist: {
        // Mirrors android.usesCleartextTraffic. Both transports are driven by the same switch so a
        // profile can never end up secure on one platform and downgraded on the other, and the
        // build-profile assertion at the top of this file guards both.
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: allowCleartext,
          NSAllowsLocalNetworking: true
        },
        // The companion discovers the paired PC over the LAN, which iOS treats as a privacy-
        // sensitive capability and will otherwise deny without an explanation.
        NSLocalNetworkUsageDescription:
          "Allow Vitana to find and connect to your paired PC on your local network.",
        NSCameraUsageDescription:
          "Allow Vitana to access your camera for QR pairing and health-report capture.",
        NSPhotoLibraryUsageDescription:
          "Allow Vitana to select a health report for private processing on your paired PC."
      }
    },
    plugins: [
      ["./plugins/withDevNetworkSecurity", { allowCleartext }],
      "react-native-iap",
      "expo-health-connect",
      // Android backup stays off (see android.allowBackup above): the encrypted database and the
      // SecureStore key must never leave the device together, so the plugin is not allowed to add
      // backup rules that would contradict that.
      ["expo-secure-store", { configureAndroidBackup: false }],
      ["expo-sqlite", { useSQLCipher: true }],
      "@react-native-community/datetimepicker",
      ["expo-image-picker", {
        photosPermission: "Allow Vitana to select a health report for private processing on your paired PC.",
        cameraPermission: "Allow Vitana to photograph a health report for private processing on your paired PC."
      }],
      ["expo-camera", {
        cameraPermission: "Allow Vitana to access your camera for QR pairing and health-report capture."
      }],
      ["expo-build-properties", {
        android: {
          minSdkVersion: 26,
          compileSdkVersion: 36,
          targetSdkVersion: 36
        }
      }]
    ],
    // Bumped by hand whenever the native layer changes, independently of the marketing `version`
    // above. An appVersion policy silently orphaned installs on every marketing bump.
    // See docs/ANDROID_RELEASE.md for the bump rule.
    runtimeVersion: "3",
    updates: {
      enabled: true,
      url: "https://u.expo.dev/2cc5cf1b-57e8-4e6f-8709-662259497a57",
      fallbackToCacheTimeout: 0
    },
    extra: {
      allowCleartext,
      eas: {
        projectId: "2cc5cf1b-57e8-4e6f-8709-662259497a57"
      }
    }
  }
};
