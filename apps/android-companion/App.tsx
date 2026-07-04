import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { syncHealthConnectLast30Days } from "./src/syncHealthConnect";

const endpointStorageKey = "local-fitness-advisor.apiEndpoint";
const defaultEndpoint = "http://192.168.1.100:4317";

export default function App() {
  const [endpointUrl, setEndpointUrl] = useState(defaultEndpoint);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [result, setResult] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(endpointStorageKey)
      .then((saved) => {
        if (saved?.trim()) {
          setEndpointUrl(saved.trim());
        }
      })
      .catch(() => {
        setStatus("Could not load saved endpoint URL.");
      });
  }, []);

  const endpointPreview = useMemo(() => endpointUrl.trim().replace(/\/+$/, ""), [endpointUrl]);

  async function saveEndpoint(): Promise<boolean> {
    if (!endpointPreview) {
      setStatus("Enter an endpoint URL.");
      return false;
    }
    await AsyncStorage.setItem(endpointStorageKey, endpointPreview);
    return true;
  }

  async function handleSyncPress(): Promise<void> {
    try {
      setSyncing(true);
      setStatus("Saving endpoint...");
      setResult("");
      const isSaved = await saveEndpoint();
      if (!isSaved) {
        return;
      }
      setStatus("Syncing last 30 days from Health Connect...");
      const syncResult = await syncHealthConnectLast30Days(endpointPreview);
      setStatus(syncResult.status);
      setResult(syncResult.details);
    } catch (error) {
      setStatus("Sync failed.");
      setResult(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Local Fitness Advisor Companion</Text>
        <Text style={styles.subtitle}>Health Connect → Local API sync (last 30 days)</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Endpoint URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setEndpointUrl}
            placeholder="http://192.168.1.100:4317"
            style={styles.input}
            value={endpointUrl}
          />
          <Text style={styles.hint}>The app posts to {endpointPreview || "<endpoint>"}/api/import/health-connect</Text>
        </View>

        <Pressable disabled={syncing} onPress={handleSyncPress} style={({ pressed }) => [styles.button, pressed && !syncing ? styles.buttonPressed : undefined, syncing ? styles.buttonDisabled : undefined]}>
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
  root: {
    flex: 1,
    backgroundColor: "#f5f7fa"
  },
  container: {
    gap: 16,
    padding: 20
  },
  title: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "700"
  },
  subtitle: {
    color: "#4b5563",
    fontSize: 14
  },
  field: {
    gap: 8
  },
  label: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "600"
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderRadius: 10,
    borderWidth: 1,
    color: "#111827",
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  hint: {
    color: "#6b7280",
    fontSize: 12
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14
  },
  buttonPressed: {
    opacity: 0.9
  },
  buttonDisabled: {
    backgroundColor: "#93c5fd"
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600"
  },
  resultCard: {
    backgroundColor: "#ffffff",
    borderColor: "#e5e7eb",
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 14
  },
  statusLabel: {
    color: "#6b7280",
    fontSize: 12,
    textTransform: "uppercase"
  },
  statusText: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "600"
  },
  resultText: {
    color: "#1f2937",
    fontSize: 14,
    lineHeight: 20
  },
});
