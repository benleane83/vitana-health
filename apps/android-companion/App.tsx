import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import {
  clearConnection,
  clearSelectedProfileId,
  HEALTH_CONNECT_CATEGORIES,
  HEALTH_CONNECT_SYNC_WINDOW_OPTIONS,
  loadConnection,
  loadSelectedProfileId,
  saveConnection,
  saveSelectedProfileId,
  updateHealthConnectSyncCursor
} from "./src/endpointStore";
import type { ConnectionDetails, HealthConnectCategory } from "./src/endpointStore";
import { PairScreen } from "./src/PairScreen";
import type { PairResult } from "./src/PairScreen";
import { pinnedFetch } from "./src/pinnedFetch";
import { syncHealthConnect } from "./src/syncHealthConnect";

const PRIVACY_POLICY_URL = "https://github.com/benleane83/local-fitness-advisor/blob/main/docs/PRIVACY_POLICY.md";

interface ProfileListEntry {
  id: string;
  displayName: string;
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionDetails | null>(null);
  const [pairScreenVisible, setPairScreenVisible] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [result, setResult] = useState("");
  const [profiles, setProfiles] = useState<ProfileListEntry[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // Avoid Android sleep/Doze interrupting long-running upload requests.
  useKeepAwake(syncing ? "health-connect-sync" : undefined);

  useEffect(() => {
    loadConnection()
      .then(setConnection)
      .catch(() => setStatus("Could not load saved connection."));
  }, []);

  useEffect(() => {
    if (!connection?.url) {
      setProfiles([]);
      setSelectedProfileId(null);
      return;
    }
    void refreshProfiles(connection);
  }, [connection?.url]);

  async function handleSyncPress(): Promise<void> {
    if (!connection?.url) {
      setStatus("No server connected. Tap Set Up Connection first.");
      return;
    }
    try {
      setSyncing(true);
      setStatus("Syncing Health Connect data…");
      setResult("");
      const syncResult = await syncHealthConnect(
        connection.url,
        connection.token,
        selectedProfileId,
        connection.publicKeyHash,
        {
          deviceId: connection.deviceId,
          syncCursor: connection.healthConnectSyncCursor,
          syncWindowDays: connection.healthConnectSyncWindowDays,
          categories: connection.healthConnectCategories
        }
      );
      if (syncResult.canAdvanceCursor) {
        await updateHealthConnectSyncCursor(connection.url, syncResult.syncCursor);
        setConnection(await loadConnection());
      }
      setStatus(syncResult.status);
      setResult(syncResult.details);
    } catch (error) {
      setStatus("Sync failed.");
      setResult(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  }

  async function handlePairComplete(pairResult: PairResult): Promise<void> {
    const fresh = await loadConnection();
    setConnection(fresh);
    setPairScreenVisible(false);
    if (fresh?.url) {
      await refreshProfiles(fresh);
    }
    setStatus(`Paired with ${pairResult.url}`);
  }

  async function handleDisconnect(): Promise<void> {
    if (!connection?.token) {
      setStatus("Cannot disconnect safely without a paired device token.");
      return;
    }
    try {
      const response = await pinnedFetch(`${connection.url.replace(/\/+$/, "")}/api/pairing/revoke-self`, connection.publicKeyHash, {
        method: "POST",
        headers: { "x-companion-token": connection.token }
      });
      if (!response.ok) throw new Error("The server did not revoke this device.");
    } catch {
      setStatus("Unable to disconnect from the server. Check your connection and try again.");
      return;
    }
    await clearConnection();
    await clearSelectedProfileId();
    setConnection(null);
    setProfiles([]);
    setSelectedProfileId(null);
    setStatus("Disconnected. Tap Set Up Connection to pair again.");
    setResult("");
  }

  async function refreshProfiles(connectionDetails: ConnectionDetails): Promise<void> {
    try {
      const response = await pinnedFetch(`${connectionDetails.url.replace(/\/+$/, "")}/api/profiles`, connectionDetails.publicKeyHash, {
        headers: connectionDetails.token ? { "x-companion-token": connectionDetails.token } : undefined
      });
      const payload = (await response.json().catch(() => ({}))) as { profiles?: ProfileListEntry[] };
      if (!response.ok || !Array.isArray(payload.profiles) || payload.profiles.length === 0) {
        setProfiles([]);
        setSelectedProfileId(null);
        return;
      }
      const stored = await loadSelectedProfileId();
      const resolved =
        (stored && payload.profiles.some((entry) => entry.id === stored) ? stored : undefined) ??
        payload.profiles[0]?.id ??
        null;
      setProfiles(payload.profiles);
      setSelectedProfileId(resolved);
      if (resolved) {
        await saveSelectedProfileId(resolved);
      }
    } catch {
      setProfiles([]);
      setSelectedProfileId(null);
    }
  }

  async function handleSelectProfile(profileId: string): Promise<void> {
    setSelectedProfileId(profileId);
    await saveSelectedProfileId(profileId);
  }

  async function handleToggleHealthConnectCategory(category: HealthConnectCategory): Promise<void> {
    if (!connection?.url) return;
    const categories = connection.healthConnectCategories.includes(category)
      ? connection.healthConnectCategories.filter((entry) => entry !== category)
      : [...connection.healthConnectCategories, category];
    const updated = await saveConnection({ ...connection, healthConnectCategories: categories });
    setConnection(updated);
  }

  async function handleSelectSyncWindow(days: number): Promise<void> {
    if (!connection?.url) return;
    const updated = await saveConnection({ ...connection, healthConnectSyncWindowDays: days });
    setConnection(updated);
  }

  async function handleAcknowledgeHealthConnectDisclosure(): Promise<void> {
    if (!connection?.url) return;
    const updated = await saveConnection({ ...connection, healthConnectDisclosureAcknowledged: true });
    setConnection(updated);
  }

  if (pairScreenVisible) {
    return (
      <PairScreen
        onComplete={(res) => { void handlePairComplete(res); }}
        onCancel={() => setPairScreenVisible(false)}
      />
    );
  }

  const isPaired = Boolean(connection?.token);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Local Fitness Advisor Companion</Text>
        <Text style={styles.subtitle}>Health Connect → Local API sync (initial window: {connection?.healthConnectSyncWindowDays ?? 30} days)</Text>

        <View style={styles.connectionCard}>
          <Text style={styles.connectionLabel}>Server connection</Text>
          {connection?.url ? (
            <View style={styles.connectionInfo}>
              <View style={styles.connectionStatus}>
                <View style={[styles.dot, isPaired ? styles.dotPaired : styles.dotUnpaired]} />
                <Text style={styles.connectionUrl} numberOfLines={1}>{connection.url}</Text>
              </View>
              {isPaired ? (
                <Text style={styles.connectionMeta}>Paired · token stored</Text>
              ) : (
                <Text style={styles.connectionMeta}>Connected (no token — pairing may be required)</Text>
              )}
              {connection.lastSyncAt ? (
                <Text style={styles.connectionMeta}>
                  Last sync: {new Date(connection.lastSyncAt).toLocaleString()}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.connectionEmpty}>Not configured</Text>
          )}
          <View style={styles.connectionButtons}>
            <Pressable style={styles.button} onPress={() => setPairScreenVisible(true)}>
              <Text style={styles.buttonText}>{connection?.url ? "Change Connection" : "Set Up Connection"}</Text>
            </Pressable>
            {connection?.url ? (
              <Pressable style={styles.buttonSecondary} onPress={() => { void handleDisconnect(); }}>
                <Text style={styles.buttonSecondaryText}>Disconnect</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {profiles.length > 0 ? (
          <View style={styles.connectionCard}>
            <Text style={styles.connectionLabel}>Target profile</Text>
            <View style={styles.profileChips}>
              {profiles.map((profile) => {
                const selected = profile.id === selectedProfileId;
                return (
                  <Pressable
                    key={profile.id}
                    style={[styles.profileChip, selected ? styles.profileChipSelected : undefined]}
                    onPress={() => { void handleSelectProfile(profile.id); }}
                  >
                    <Text style={[styles.profileChipText, selected ? styles.profileChipTextSelected : undefined]}>
                      {profile.displayName}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.connectionCard}>
          <Text style={styles.connectionLabel}>Health data to sync</Text>
          <View style={styles.profileChips}>
            {HEALTH_CONNECT_CATEGORIES.map((category) => {
              const selected = connection?.healthConnectCategories.includes(category) ?? false;
              return (
                <Pressable
                  key={category}
                  style={[styles.profileChip, selected ? styles.profileChipSelected : undefined]}
                  onPress={() => { void handleToggleHealthConnectCategory(category); }}
                >
                  <Text style={[styles.profileChipText, selected ? styles.profileChipTextSelected : undefined]}>{category}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.connectionMeta}>Choose only data needed for your local wellness analytics. Permissions can be changed in Health Connect.</Text>
          <Text style={styles.connectionLabel}>Initial sync window</Text>
          <View style={styles.profileChips}>
            {HEALTH_CONNECT_SYNC_WINDOW_OPTIONS.map((days) => {
              const selected = connection?.healthConnectSyncWindowDays === days;
              return (
                <Pressable
                  key={days}
                  style={[styles.profileChip, selected ? styles.profileChipSelected : undefined]}
                  onPress={() => { void handleSelectSyncWindow(days); }}
                >
                  <Text style={[styles.profileChipText, selected ? styles.profileChipTextSelected : undefined]}>{days} days</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.connectionMeta}>The initial import is limited to 30–365 days. Later syncs use a cursor to import new data.</Text>
        </View>

        {!connection?.healthConnectDisclosureAcknowledged ? (
          <View style={styles.connectionCard}>
            <Text style={styles.connectionLabel}>Before Health Connect permissions</Text>
            <Text style={styles.disclosureText}>
              Local Fitness Advisor requests read access only for the categories you select. It sends selected records to your paired local API over HTTPS with certificate pinning for local storage and analytics. It does not use Health Connect data for advertising or sell it.
            </Text>
            <Pressable onPress={() => { void Linking.openURL(PRIVACY_POLICY_URL); }}>
              <Text style={styles.privacyLink}>Read the privacy policy</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => { void handleAcknowledgeHealthConnectDisclosure(); }}>
              <Text style={styles.buttonText}>I understand and continue</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => { void Linking.openURL(PRIVACY_POLICY_URL); }}>
            <Text style={styles.privacyLink}>Privacy policy</Text>
          </Pressable>
        )}

        <Pressable
          disabled={syncing || !connection?.url || !connection.healthConnectDisclosureAcknowledged}
          onPress={() => { void handleSyncPress(); }}
          style={({ pressed }) => [
            styles.syncButton,
            pressed && !syncing ? styles.buttonPressed : undefined,
            syncing || !connection?.url || !connection.healthConnectDisclosureAcknowledged ? styles.buttonDisabled : undefined
          ]}
        >
          {syncing ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Sync now</Text>}
        </Pressable>

        <View style={styles.resultCard}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={styles.statusText}>{status}</Text>
          {result ? <Text style={styles.resultText}>{result}</Text> : undefined}
        </View>
      </ScrollView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f5f7fa" },
  container: { gap: 16, padding: 20 },
  title: { color: "#111827", fontSize: 24, fontWeight: "700" },
  subtitle: { color: "#4b5563", fontSize: 14 },
  connectionCard: {
    backgroundColor: "#ffffff",
    borderColor: "#e5e7eb",
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 14
  },
  connectionLabel: { color: "#6b7280", fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  connectionInfo: { gap: 4 },
  connectionStatus: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotPaired: { backgroundColor: "#22c55e" },
  dotUnpaired: { backgroundColor: "#f59e0b" },
  connectionUrl: { color: "#111827", fontSize: 14, fontWeight: "600", flex: 1 },
  connectionMeta: { color: "#6b7280", fontSize: 12 },
  disclosureText: { color: "#374151", fontSize: 14, lineHeight: 20 },
  privacyLink: { color: "#2563eb", fontSize: 14, fontWeight: "600" },
  connectionEmpty: { color: "#9ca3af", fontSize: 14 },
  connectionButtons: { flexDirection: "row", gap: 8 },
  profileChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  profileChip: {
    backgroundColor: "#f3f4f6",
    borderColor: "#e5e7eb",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  profileChipSelected: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb"
  },
  profileChipText: { color: "#374151", fontSize: 13, fontWeight: "600" },
  profileChipTextSelected: { color: "#ffffff" },
  button: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12
  },
  buttonSecondary: {
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderColor: "#e5e7eb",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14
  },
  buttonSecondaryText: { color: "#374151", fontSize: 14, fontWeight: "600" },
  syncButton: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14
  },
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { backgroundColor: "#93c5fd" },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  resultCard: {
    backgroundColor: "#ffffff",
    borderColor: "#e5e7eb",
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 14
  },
  statusLabel: { color: "#6b7280", fontSize: 12, textTransform: "uppercase" },
  statusText: { color: "#111827", fontSize: 16, fontWeight: "600" },
  resultText: { color: "#1f2937", fontSize: 14, lineHeight: 20 }
});
