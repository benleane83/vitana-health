import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ChartNoAxesColumnIncreasing, Home, MonitorSmartphone, Plus } from "lucide-react-native";
import { MobileApiProvider, useMobileApi } from "./src/MobileApiProvider";
import { EntitlementProvider } from "./src/EntitlementProvider";
import { PairScreen } from "./src/PairScreen";
import type { RootStackParamList, TabParamList } from "./src/navigationTypes";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { ImportScreen } from "./src/screens/ImportScreen";
import { TrackDetailScreen } from "./src/screens/TrackDetailScreen";
import { TrackScreen } from "./src/screens/TrackScreen";
import { Button, Card, Message, Screen } from "./src/ui/components";
import { colors, radii, spacing, type } from "./src/ui/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <EntitlementProvider>
        <MobileApiProvider>
          <NavigationContainer>
            <Stack.Navigator>
              <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
              <Stack.Screen name="Pair" component={PairRoute} options={{ presentation: "modal", title: "Pair this phone" }} />
              <Stack.Screen name="Connection" component={ConnectionScreen} options={{ presentation: "modal", title: "Connection" }} />
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
    </SafeAreaProvider>
  );
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
    </Tabs.Navigator>
  );
}

function PairRoute({ navigation }: NativeStackScreenProps<RootStackParamList, "Pair">) {
  const { reloadConnection } = useMobileApi();
  return (
    <PairScreen
      onComplete={() => {
        void reloadConnection().then(() => navigation.goBack());
      }}
      onCancel={() => navigation.goBack()}
    />
  );
}

function ConnectionScreen({ navigation }: NativeStackScreenProps<RootStackParamList, "Connection">) {
  const { bootstrap, connection, connectionState, demoMode, disconnect, error, setDemoMode } = useMobileApi();
  return (
    <Screen>
      <Card>
        <Text style={styles.label}>Status</Text>
        <Text style={styles.heading}>{demoMode ? "Sample data" : connectionState.replaceAll("-", " ")}</Text>
        <Text style={styles.meta}>{demoMode ? "Read-only demo" : connection?.url ?? "No paired PC"}</Text>
        {bootstrap ? <Text style={styles.meta}>Assigned to {bootstrap.profile.displayName}</Text> : null}
        {error ? <Message title="Connection issue" detail={error} tone="danger" /> : null}
      </Card>
      <View style={styles.settingRow}>
        <View style={styles.settingText}>
          <Text style={styles.settingTitle}>Demo mode</Text>
          <Text style={styles.meta}>Explore read-only sample health data without a PC.</Text>
        </View>
        <Switch
          accessibilityLabel="Demo mode"
          value={demoMode}
          onValueChange={(enabled) => { void setDemoMode(enabled); }}
        />
      </View>
      {!demoMode ? <Button onPress={() => navigation.navigate("Pair")}>{connection ? "Re-pair" : "Pair with PC"}</Button> : null}
      {connection && !demoMode ? (
        <Button secondary onPress={() => {
          void disconnect().then(() => navigation.goBack()).catch(() => undefined);
        }}>Revoke and disconnect</Button>
      ) : null}
      <Message
        title={demoMode ? "Your connection is unchanged" : "Local-first connection"}
        detail={demoMode
          ? "Turn off Demo mode to return to your paired PC. Sample data is stored separately from your health records."
          : "Health data is fetched only while your paired PC is reachable and is not cached on this phone."}
      />
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
  settingTitle: { color: colors.text, fontSize: type.title, fontWeight: "700" }
});
