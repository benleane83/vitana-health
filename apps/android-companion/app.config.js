const allowCleartext = process.env.LFA_ALLOW_CLEARTEXT === "1";

module.exports = {
  expo: {
    name: "Local Fitness Companion",
    slug: "local-fitness-companion",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    android: {
      package: "com.localfitnessadvisor.companion",
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
      "expo-secure-store",
      ["expo-camera", {
        cameraPermission: "Allow Local Fitness Companion to access your camera for QR code scanning."
      }],
      ["expo-build-properties", {
        android: {
          minSdkVersion: 26,
          compileSdkVersion: 36,
          targetSdkVersion: 35
        }
      }]
    ],
    runtimeVersion: {
      policy: "appVersion"
    },
    updates: {
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
