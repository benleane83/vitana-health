const allowCleartext = process.env.LFA_ALLOW_CLEARTEXT === "1";
const standalonePoc = process.env.LFA_STANDALONE_POC === "1";

module.exports = {
  expo: {
    name: standalonePoc ? "Local Fitness Standalone Test" : "Local Fitness Companion",
    slug: standalonePoc ? "local-fitness-standalone-test" : "local-fitness-companion",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    android: {
      package: standalonePoc
        ? "com.localfitnessadvisor.companion.standalone"
        : "com.localfitnessadvisor.companion",
      allowBackup: false,
      usesCleartextTraffic: allowCleartext,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.health.READ_STEPS",
        "android.permission.health.READ_HEART_RATE",
        "android.permission.health.READ_OXYGEN_SATURATION",
        "android.permission.health.READ_RESPIRATORY_RATE",
        "android.permission.health.READ_HEART_RATE_VARIABILITY",
        "android.permission.health.READ_BASAL_BODY_TEMPERATURE",
        "android.permission.health.READ_BASAL_METABOLIC_RATE",
        "android.permission.health.READ_BLOOD_GLUCOSE",
        "android.permission.health.READ_BLOOD_PRESSURE",
        "android.permission.health.READ_BODY_TEMPERATURE",
        "android.permission.health.READ_HEIGHT",
        "android.permission.health.READ_SKIN_TEMPERATURE",
        "android.permission.health.READ_VO2_MAX",
        "android.permission.health.READ_WEIGHT",
        "android.permission.health.READ_DISTANCE",
        "android.permission.health.READ_FLOORS_CLIMBED",
        "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
        "android.permission.health.READ_TOTAL_CALORIES_BURNED",
        "android.permission.health.READ_SLEEP",
        "android.permission.health.READ_BODY_FAT",
        "android.permission.health.READ_LEAN_BODY_MASS",
        "android.permission.health.READ_BODY_WATER_MASS",
        "android.permission.health.READ_BONE_MASS",
        "android.permission.health.READ_EXERCISE",
        "android.permission.health.READ_HEALTH_DATA_HISTORY"
      ],
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png"
      },
      predictiveBackGestureEnabled: false
    },
    plugins: [
      ["./plugins/withDevNetworkSecurity", { allowCleartext }],
      "expo-health-connect",
      ["expo-secure-store", { configureAndroidBackup: true }],
      ["expo-sqlite", { useSQLCipher: true }],
      "@react-native-community/datetimepicker",
      ["expo-image-picker", {
        photosPermission: "Allow Local Fitness Companion to select a health report for private processing on your paired PC.",
        cameraPermission: "Allow Local Fitness Companion to photograph a health report for private processing on your paired PC."
      }],
      ["expo-camera", {
        cameraPermission: "Allow Local Fitness Companion to access your camera for QR pairing and health-report capture."
      }],
      ["expo-build-properties", {
        android: {
          minSdkVersion: 26,
          compileSdkVersion: 36,
          targetSdkVersion: 35
        }
      }]
    ],
    runtimeVersion: standalonePoc ? "standalone-poc-1.0.0" : "1.0.0",
    updates: {
      enabled: !standalonePoc,
      url: "https://u.expo.dev/2cc5cf1b-57e8-4e6f-8709-662259497a57",
      fallbackToCacheTimeout: 0
    },
    extra: {
      allowCleartext,
      standalonePoc,
      eas: {
        projectId: "2cc5cf1b-57e8-4e6f-8709-662259497a57"
      }
    }
  }
};
