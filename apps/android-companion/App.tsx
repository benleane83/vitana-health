import { Pressable, StyleSheet, Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { MobileApiProvider, useMobileApi } from "./src/MobileApiProvider";
import { PairScreen } from "./src/PairScreen";
import type { RootStackParamList, TabParamList } from "./src/navigationTypes";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { ImportScreen } from "./src/screens/ImportScreen";
import { TrackDetailScreen } from "./src/screens/TrackDetailScreen";
import { TrackScreen } from "./src/screens/TrackScreen";
import { Button, Card, Message, Screen } from "./src/ui/components";
import { colors, spacing } from "./src/ui/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
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
    </SafeAreaProvider>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ navigation }) => ({
        headerRight: () => (
          <Pressable accessibilityRole="button" onPress={() => navigation.getParent()?.navigate("Connection")}>
            <Text style={styles.connectionButton}>Connection</Text>
          </Pressable>
        ),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted
      })}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarIcon: () => <Text>⌂</Text> }} />
      <Tabs.Screen name="Import" component={ImportScreen} options={{ tabBarIcon: () => <Text>＋</Text> }} />
      <Tabs.Screen name="Track" component={TrackScreen} options={{ tabBarIcon: () => <Text>⌁</Text> }} />
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
  const { bootstrap, connection, connectionState, disconnect, error } = useMobileApi();
  return (
    <Screen>
      <Card>
        <Text style={styles.label}>Status</Text>
        <Text style={styles.heading}>{connectionState.replaceAll("-", " ")}</Text>
        <Text style={styles.meta}>{connection?.url ?? "No paired PC"}</Text>
        {bootstrap ? <Text style={styles.meta}>Assigned to {bootstrap.profile.displayName}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
      <Button onPress={() => navigation.navigate("Pair")}>{connection ? "Re-pair" : "Pair with PC"}</Button>
      {connection ? (
        <Button secondary onPress={() => {
          void disconnect().then(() => navigation.goBack()).catch(() => undefined);
        }}>Revoke and disconnect</Button>
      ) : null}
      <Message title="Local-first connection" detail="Health data is fetched only while your paired PC is reachable and is not cached on this phone." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  connectionButton: { color: colors.primary, fontWeight: "700", marginRight: spacing.sm },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  heading: { color: colors.text, fontSize: 20, fontWeight: "800", textTransform: "capitalize" },
  meta: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 }
});
