const allowCleartext = process.env.VITANA_ALLOW_CLEARTEXT === "1";

module.exports = {
  expo: {
    name: "Vitana",
    slug: "local-fitness-companion",
    version: "0.1.0",
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
        "android.permission.health.READ_OXYGEN_SATURATION",
        "android.permission.health.READ_HEART_RATE_VARIABILITY",
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
    plugins: [
      ["./plugins/withDevNetworkSecurity", { allowCleartext }],
      "react-native-iap",
      "expo-health-connect",
      ["expo-secure-store", { configureAndroidBackup: true }],
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
          targetSdkVersion: 35
        }
      }]
    ],
    runtimeVersion: { policy: "appVersion" },
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
