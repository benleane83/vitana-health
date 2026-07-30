import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { ChartNoAxesColumnIncreasing, HeartPulse, Home, MonitorSmartphone, Plus } from "lucide-react-native";
import { MobileApiProvider, useMobileApi } from "./src/MobileApiProvider";
import { AppErrorBoundary } from "./src/AppErrorBoundary";
import { appBuildLabel } from "./src/appBuildInfo";
import { EntitlementProvider } from "./src/EntitlementProvider";
import { ELASTIC_LICENSE_2_0_DISPLAY_TEXT, SOFTWARE_COPYRIGHT } from "./src/legal";
import { PairScreen } from "./src/PairScreen";
import type { RootStackParamList, TabParamList } from "./src/navigationTypes";
import { assertTransportSecurity } from "./src/transportSecurity";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { ImportScreen } from "./src/screens/ImportScreen";
import { TrackDetailScreen } from "./src/screens/TrackDetailScreen";
import { TrackScreen } from "./src/screens/TrackScreen";
import { CareScreen } from "./src/screens/CareScreen";
import { Button, Card, Loading, Message, Screen } from "./src/ui/components";
import { colors, radii, spacing, type } from "./src/ui/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <TransportSecurityGate>
          <EntitlementProvider>
            <MobileApiProvider>
              <NavigationContainer>
                <Stack.Navigator>
                  <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
                  <Stack.Screen name="Pair" component={PairRoute} options={{ presentation: "modal", title: "Pair this phone" }} />
                  <Stack.Screen name="Connection" component={ConnectionScreen} options={{ presentation: "modal", title: "Connection" }} />
                  <Stack.Screen name="License" component={LicenseScreen} options={{ title: "Software license" }} />
                  <Stack.Screen
                    name="TrackDetail"
                    component={TrackDetailScreen}
                    options={({ route }) => ({ title: route.params.displayName })}
                  />
                </Stack.Navigator>
              </NavigationContainer>
              <StatusBar style="dark" />
            </MobileApiProvider>
          </EntitlementProvider>
        </TransportSecurityGate>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

/**
 * Renders nothing of its own: it exists so the transport-security check runs inside the error
 * boundary, where a failure becomes a readable screen instead of a white one.
 */
function TransportSecurityGate({ children }: { children: ReactNode }) {
  assertTransportSecurity({
    isDevelopmentBuild: __DEV__,
    allowCleartext: Constants.expoConfig?.extra?.allowCleartext === true
  });
  return <>{children}</>;
}

function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs.Navigator
      screenOptions={({ navigation }) => ({
        headerRight: () => (
          <Pressable
            accessibilityLabel="Connection"
            accessibilityRole="button"
            onPress={() => navigation.getParent()?.navigate("Connection")}
            style={styles.connectionButton}
          >
            <MonitorSmartphone color={colors.primary} size={18} strokeWidth={2.2} />
            <Text style={styles.connectionButtonText}>Connection</Text>
          </Pressable>
        ),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarItemStyle: styles.tabItem,
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: [
          styles.tabBar,
          {
            height: 68 + insets.bottom,
            paddingBottom: Math.max(insets.bottom, spacing.xs)
          }
        ]
      })}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="Import" component={ImportScreen} options={{ tabBarIcon: ({ color, size }) => <Plus color={color} size={size} /> }} />
      <Tabs.Screen name="Track" component={TrackScreen} options={{ tabBarIcon: ({ color, size }) => <ChartNoAxesColumnIncreasing color={color} size={size} /> }} />
      <Tabs.Screen name="Care" component={CareScreen} options={{ tabBarIcon: ({ color, size }) => <HeartPulse color={color} size={size} /> }} />
    </Tabs.Navigator>
  );
}

function PairRoute({ navigation }: NativeStackScreenProps<RootStackParamList, "Pair">) {
  const { reloadConnection } = useMobileApi();
  return (
    <PairScreen
      onComplete={() => {
        void reloadConnection().then(() => navigation.replace("Connection", { activatePairing: true }));
      }}
      onCancel={() => navigation.goBack()}
    />
  );
}

function ConnectionScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Connection">) {
  const {
    bootstrap,
    cancelPendingConnection,
    connection,
    connectionState,
    demoMode,
    discardStandaloneDataAndConnect,
    disconnect,
    error,
    migrateStandaloneData,
    migrationProgress,
    resetStandaloneData,
    setDemoMode,
    setOperatingMode,
    standaloneMigrationManifest,
    standaloneMode
  } = useMobileApi();
  const migrationActive = migrationProgress !== undefined;
  const [activationActive, setActivationActive] = useState(false);
  const connectionBusy = migrationActive || activationActive;
  const activationPromptHandled = useRef(false);

  async function activateConnected(task: () => Promise<unknown>) {
    setActivationActive(true);
    try {
      await task();
    } finally {
      setActivationActive(false);
    }
  }

  function beginConnectedActivation() {
    if (connectionBusy) return;
    void standaloneMigrationManifest().then((manifest) => {
      const total = Object.values(manifest.counts).reduce((sum, count) => sum + count, 0);
      if (total === 0) {
        void activateConnected(() => setOperatingMode("connected")).catch((caught: unknown) => {
          Alert.alert("Unable to connect", caught instanceof Error ? caught.message : "The initial offline copy could not be prepared.");
        });
        return;
      }
      Alert.alert(
          "Connect to paired PC?",
          `This Standalone dataset contains ${manifest.counts.observations} observation(s), ` +
            `${manifest.counts.sourceImports} import(s), ${manifest.counts.dataSources} source(s), and ` +
            `${manifest.counts.observationGroups} group(s).`,
          [
            {
              text: "Cancel pairing",
              style: "cancel",
              onPress: () => {
                void cancelPendingConnection().catch((caught: unknown) => {
                  Alert.alert("Unable to cancel pairing", caught instanceof Error ? caught.message : "Try again.");
                });
              }
            },
            {
              text: "Delete phone data",
              style: "destructive",
              onPress: () => Alert.alert(
                "Delete phone data and connect?",
                "This permanently deletes the current local profile and its readings from this phone. Data already on your PC will not change.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete and connect",
                    style: "destructive",
                    onPress: () => {
                      void activateConnected(discardStandaloneDataAndConnect).catch((caught: unknown) => {
                        Alert.alert("Unable to connect", caught instanceof Error ? caught.message : "The local dataset was not changed.");
                      });
                    }
                  }
                ]
              )
            },
            {
              text: "Merge and connect",
              onPress: () => {
                void migrateStandaloneData().then((receipt) => {
                  Alert.alert(
                    "Merge verified",
                    `${receipt.counts.accepted} accepted, ${receipt.counts.duplicates} duplicate(s), ` +
                      `${receipt.counts.conflicts} conflict(s). The original dataset is now a read-only archive.`,
                    [{
                      text: "Continue",
                      onPress: () => {
                        void activateConnected(() => setOperatingMode("connected")).catch((caught: unknown) => {
                          Alert.alert("Unable to connect", caught instanceof Error ? caught.message : "The initial offline copy could not be prepared.");
                        });
                      }
                    }]
                  );
                }).catch((caught: unknown) => {
                  Alert.alert("Merge failed", caught instanceof Error ? caught.message : "The local dataset was not changed.");
                });
              }
            }
          ]
      );
    }).catch((caught: unknown) => {
      Alert.alert("Unable to inspect local data", caught instanceof Error ? caught.message : "Try again.");
    });
  }

  useEffect(() => {
    if (
      route.params?.activatePairing &&
      connection?.token &&
      standaloneMode &&
      !migrationActive &&
      !activationPromptHandled.current
    ) {
      activationPromptHandled.current = true;
      beginConnectedActivation();
    }
  }, [connection?.token, migrationActive, route.params?.activatePairing, standaloneMode]);

  return (
    <Screen>
      <Card>
        <Text style={styles.label}>Status</Text>
        <Text style={styles.heading}>{demoMode ? "Sample data" : standaloneMode ? connection ? "Setup incomplete" : "On this phone" : connectionState.replaceAll("-", " ")}</Text>
        <Text style={styles.meta}>{demoMode ? "Read-only demo" : standaloneMode ? "Encrypted storage on this phone" : connection?.url ?? "No paired PC"}</Text>
        {bootstrap ? <Text style={styles.meta}>Saving to {bootstrap.profile.displayName}</Text> : null}
        {error ? <Message title="Connection issue" detail={error} tone="danger" /> : null}
        {migrationProgress ? (
          <Text style={styles.meta}>Uploading migration batch {migrationProgress.uploaded} of {migrationProgress.total}…</Text>
        ) : null}
        {activationActive ? <Loading label="Preparing encrypted offline copy…" /> : null}
      </Card>
      <View style={styles.settingRow}>
        <View style={styles.settingText}>
          <Text style={styles.settingTitle}>Demo mode</Text>
          <Text style={styles.meta}>Explore read-only sample data without a PC.</Text>
        </View>
        <Switch
          accessibilityLabel="Demo mode"
          disabled={connectionBusy}
          value={demoMode}
          onValueChange={(enabled) => { void setDemoMode(enabled); }}
        />
      </View>
      {!demoMode && !connection ? <Button disabled={connectionBusy} onPress={() => navigation.navigate("Pair")}>Pair with PC</Button> : null}
      {!demoMode && connection && standaloneMode ? <Button disabled={connectionBusy} onPress={beginConnectedActivation}>{activationActive ? "Preparing offline copy…" : "Finish connecting"}</Button> : null}
      {!demoMode && connection && standaloneMode ? (
        <Button disabled={connectionBusy} secondary onPress={() => {
          void cancelPendingConnection().catch((caught: unknown) => {
            Alert.alert("Unable to cancel pairing", caught instanceof Error ? caught.message : "Try again.");
          });
        }}>Cancel pairing</Button>
      ) : null}
      {connection && !demoMode && !standaloneMode ? (
        <Button disabled={connectionBusy} secondary onPress={() => {
          Alert.alert(
            "Unpair this phone?",
            "The downloaded copy of your PC data will be removed from this phone. Your PC data will not change, and a new empty local profile will be created.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Unpair and remove copy",
                style: "destructive",
                onPress: () => {
                  void disconnect()
                    .then(() => navigation.goBack())
                    .catch((caught: unknown) => {
                      Alert.alert("Unable to unpair", caught instanceof Error ? caught.message : "Try again.");
                    });
                }
              }
            ]
          );
        }}>Unpair</Button>
      ) : null}
      {standaloneMode && !demoMode ? (
        <Button disabled={migrationActive} secondary onPress={() => Alert.alert(
          "Reset standalone data?",
          "This permanently deletes the local profile and all readings stored by this test app.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete local data",
              style: "destructive",
              onPress: () => { void resetStandaloneData(); }
            }
          ]
        )}>Reset local data</Button>
      ) : null}
      <Message
        title={demoMode ? "Your connection is unchanged" : "Local-first connection"}
        detail={demoMode
          ? "Turn off Demo mode to return to your health data. Sample data is stored separately from your health records."
          : standaloneMode
            ? "Health data is kept in a encrypted database on your phone. Pairing with a PC does not upload it."
            : "Vitana keeps an encrypted read-only copy of data for offline viewing. Unpairing removes that data from this phone."}
      />
      <Button secondary onPress={() => navigation.navigate("License")}>Software license</Button>
      <Text accessibilityLabel={appBuildLabel} style={styles.buildLabel}>{appBuildLabel}</Text>
    </Screen>
  );
}

function LicenseScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.licenseContent}>
        <Text style={styles.licenseCopyright} selectable>{SOFTWARE_COPYRIGHT}</Text>
        <Text style={styles.meta}>Vitana Health is source-available under the following terms.</Text>
        <Text style={styles.licenseText} selectable>{ELASTIC_LICENSE_2_0_DISPLAY_TEXT}</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  connectionButton: { alignItems: "center", flexDirection: "row", gap: spacing.xs, marginRight: spacing.sm },
  connectionButtonText: { color: colors.primary, fontWeight: "700" },
  tabBar: { backgroundColor: colors.surface, borderTopColor: colors.border, paddingTop: spacing.xs },
  tabItem: { borderRadius: radii.sm, minHeight: 56 },
  tabLabel: { fontSize: type.label, fontWeight: "700", lineHeight: 18 },
  label: { color: colors.muted, fontSize: type.label, fontWeight: "700", textTransform: "uppercase" },
  heading: { color: colors.text, fontSize: type.heading, fontWeight: "800", textTransform: "capitalize" },
  meta: { color: colors.muted, fontSize: type.body, lineHeight: 20 },
  settingRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between", paddingVertical: spacing.sm },
  settingText: { flex: 1, gap: spacing.xs },
  settingTitle: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  buildLabel: { color: colors.muted, fontSize: type.label, lineHeight: 18, paddingTop: spacing.sm, textAlign: "center" },
  licenseContent: { gap: spacing.sm, paddingBottom: spacing.xl },
  licenseCopyright: { color: colors.textStrong, fontSize: type.title, fontWeight: "700" },
  licenseText: { color: colors.text, fontSize: type.body, lineHeight: 22 }
});
