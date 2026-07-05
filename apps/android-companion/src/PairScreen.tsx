import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import Zeroconf from "react-native-zeroconf";
import { getDeviceId, saveConnection } from "./endpointStore";

type PairMode = "qr" | "network";
type PairStatus = "idle" | "detected" | "requesting" | "waiting" | "approved" | "denied" | "error";

interface DiscoveredService {
  name: string;
  host: string;
  port: number;
  addresses: string[];
}

export interface PairResult {
  url: string;
  token: string | null;
}

export function PairScreen({
  onComplete,
  onCancel
}: {
  onComplete: (result: PairResult) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<PairMode>("qr");
  const [status, setStatus] = useState<PairStatus>("idle");
  const [message, setMessage] = useState("");
  const [detectedUrl, setDetectedUrl] = useState("");
  const [discoveredServices, setDiscoveredServices] = useState<DiscoveredService[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  function handleQrScanned(data: string) {
    if (scannedRef.current || status !== "idle") return;
    scannedRef.current = true;
    try {
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (typeof payload.url === "string" && payload.app === "local-fitness-advisor") {
        const url = payload.url.replace(/\/+$/, "");
        setDetectedUrl(url);
        setStatus("detected");
        setMessage(`Found server: ${url}`);
      } else {
        setMessage("This QR code is not a Local Fitness Advisor pairing code. Try again.");
        scannedRef.current = false;
      }
    } catch {
      setMessage("Could not read QR code. Aim at the pairing QR code shown in the web app.");
      scannedRef.current = false;
    }
  }

  function handleServiceSelected(service: DiscoveredService) {
    const ip = service.addresses[0] ?? service.host;
    const url = `http://${ip}:${service.port}`;
    setDetectedUrl(url);
    setStatus("detected");
    setMessage(`Found server: ${url}`);
  }

  async function handleConnect() {
    if (!detectedUrl) return;
    setStatus("requesting");
    setMessage("Sending pairing request…");
    try {
      const deviceId = await getDeviceId();
      const response = await fetch(`${detectedUrl}/api/pairing/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ deviceId, deviceName: "Android Companion" })
      });
      const body = (await response.json()) as Record<string, unknown>;

      if (body.status === "approved" && typeof body.token === "string") {
        await saveConnection({ url: detectedUrl, token: body.token, pairedAt: new Date().toISOString() });
        setStatus("approved");
        setMessage("Paired successfully! Returning to sync screen…");
        setTimeout(() => onComplete({ url: detectedUrl, token: body.token as string }), 1500);
        return;
      }

      if (typeof body.pairingId === "string") {
        setStatus("waiting");
        setMessage("Waiting for approval in the web app on your PC…");
        pollForApproval(detectedUrl, body.pairingId);
      } else {
        setStatus("error");
        setMessage(typeof body.error === "string" ? body.error : "Pairing request failed.");
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Connection failed. Check the server is running and reachable on the network.");
    }
  }

  function pollForApproval(url: string, pairingId: string) {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60;

    async function poll() {
      if (cancelled || attempts >= maxAttempts) {
        if (!cancelled) {
          setStatus("error");
          setMessage("Pairing timed out. Approve the request in the web app and try again.");
        }
        return;
      }
      attempts++;
      try {
        const response = await fetch(`${url}/api/pairing/status/${pairingId}`, {
          headers: { Accept: "application/json" }
        });
        const body = (await response.json()) as Record<string, unknown>;
        if (body.status === "approved" && typeof body.token === "string") {
          cancelled = true;
          await saveConnection({ url, token: body.token, pairedAt: new Date().toISOString() });
          setStatus("approved");
          setMessage("Paired successfully! Returning to sync screen…");
          setTimeout(() => onComplete({ url, token: body.token as string }), 1500);
        } else if (body.status === "denied") {
          cancelled = true;
          setStatus("denied");
          setMessage("Pairing was denied on the PC. Ask the user to approve and try again.");
        } else {
          setTimeout(() => { void poll(); }, 5000);
        }
      } catch {
        setTimeout(() => { void poll(); }, 5000);
      }
    }

    void poll();
  }

  function startNetworkDiscovery() {
    setDiscovering(true);
    setDiscoveredServices([]);

    const zeroconf = new Zeroconf();
    const found = new Map<string, DiscoveredService>();

    zeroconf.on("resolved", (service: DiscoveredService) => {
      found.set(service.name, service);
      setDiscoveredServices([...found.values()]);
    });

    zeroconf.on("removed", (service: { name: string }) => {
      found.delete(service.name);
      setDiscoveredServices([...found.values()]);
    });

    zeroconf.scan("local-fitness-advisor", "tcp", "local.");

    setTimeout(() => {
      zeroconf.stop();
      setDiscovering(false);
    }, 10000);
  }

  function resetAndSwitchMode(newMode: PairMode) {
    scannedRef.current = false;
    setStatus("idle");
    setMessage("");
    setDetectedUrl("");
    setMode(newMode);
  }

  function retryCurrentMode() {
    scannedRef.current = false;
    setStatus("idle");
    setMessage("");
    setDetectedUrl("");
  }

  const isError = status === "error" || status === "denied";

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Set Up Connection</Text>
          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>Connect to a Local Fitness Advisor instance running on your network.</Text>

        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, mode === "qr" && styles.tabActive]}
            onPress={() => resetAndSwitchMode("qr")}
          >
            <Text style={[styles.tabText, mode === "qr" && styles.tabTextActive]}>Scan QR Code</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, mode === "network" && styles.tabActive]}
            onPress={() => resetAndSwitchMode("network")}
          >
            <Text style={[styles.tabText, mode === "network" && styles.tabTextActive]}>Find on Network</Text>
          </Pressable>
        </View>

        {mode === "qr" ? (
          <View style={styles.section}>
            <Text style={styles.instructions}>
              Open the web app, go to Import → Fitness Tracker, and scan the QR code shown there.
            </Text>
            {status === "idle" ? (
              cameraPermission?.granted ? (
                <View style={styles.cameraContainer}>
                  <CameraView
                    style={styles.camera}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={({ data }) => handleQrScanned(data)}
                  />
                </View>
              ) : (
                <View style={styles.permissionCard}>
                  <Text style={styles.permissionText}>Camera access is needed to scan the QR code.</Text>
                  <Pressable style={styles.button} onPress={() => { void requestCameraPermission(); }}>
                    <Text style={styles.buttonText}>Grant Camera Permission</Text>
                  </Pressable>
                </View>
              )
            ) : null}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.instructions}>
              Searches for a Local Fitness Advisor instance advertising on your local network via mDNS.
            </Text>
            {status === "idle" && !discovering ? (
              <Pressable style={styles.button} onPress={startNetworkDiscovery}>
                <Text style={styles.buttonText}>Search Network</Text>
              </Pressable>
            ) : null}
            {discovering ? (
              <View style={styles.discoveringRow}>
                <ActivityIndicator color="#2563eb" />
                <Text style={styles.discoveringText}>Scanning for 10 seconds…</Text>
              </View>
            ) : null}
            {discoveredServices.length > 0 ? (
              <View style={styles.serviceList}>
                <Text style={styles.serviceListLabel}>Tap a server to connect:</Text>
                {discoveredServices.map((service) => (
                  <Pressable
                    key={service.name}
                    style={styles.serviceItem}
                    onPress={() => handleServiceSelected(service)}
                  >
                    <Text style={styles.serviceName}>{service.name}</Text>
                    <Text style={styles.serviceAddr}>
                      {service.addresses[0] ?? service.host}:{service.port}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {!discovering && discoveredServices.length === 0 && status === "idle" ? (
              <Text style={styles.hint}>No servers found yet. Tap Search to scan the network.</Text>
            ) : null}
          </View>
        )}

        {message ? (
          <View style={[styles.messageCard, isError ? styles.messageCardError : undefined]}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        ) : null}

        {status === "detected" ? (
          <Pressable style={styles.button} onPress={() => { void handleConnect(); }}>
            <Text style={styles.buttonText}>Connect &amp; Pair</Text>
          </Pressable>
        ) : null}

        {status === "waiting" ? (
          <View style={styles.waitingCard}>
            <ActivityIndicator color="#2563eb" />
            <Text style={styles.waitingText}>
              Approve the pairing request in the web app on your PC.
            </Text>
          </View>
        ) : null}

        {isError ? (
          <Pressable style={styles.button} onPress={retryCurrentMode}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f5f7fa" },
  container: { gap: 16, padding: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: "#111827", fontSize: 22, fontWeight: "700" },
  cancelButton: { paddingHorizontal: 12, paddingVertical: 6 },
  cancelText: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  subtitle: { color: "#4b5563", fontSize: 14 },
  tabs: { flexDirection: "row", gap: 8 },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#e5e7eb"
  },
  tabActive: { backgroundColor: "#2563eb" },
  tabText: { color: "#374151", fontWeight: "600", fontSize: 14 },
  tabTextActive: { color: "#ffffff" },
  section: { gap: 12 },
  instructions: { color: "#4b5563", fontSize: 14, lineHeight: 20 },
  cameraContainer: { height: 280, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  camera: { flex: 1 },
  permissionCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    gap: 12
  },
  permissionText: { color: "#374151", fontSize: 14 },
  button: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14
  },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  discoveringRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  discoveringText: { color: "#4b5563", fontSize: 14 },
  serviceList: { gap: 8 },
  serviceListLabel: { color: "#6b7280", fontSize: 13, fontWeight: "600" },
  serviceItem: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 14,
    gap: 4
  },
  serviceName: { color: "#111827", fontSize: 15, fontWeight: "600" },
  serviceAddr: { color: "#6b7280", fontSize: 13 },
  hint: { color: "#6b7280", fontSize: 13 },
  messageCard: {
    backgroundColor: "#f0fdf4",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    padding: 14
  },
  messageCardError: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca"
  },
  messageText: { color: "#111827", fontSize: 14 },
  waitingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#eff6ff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    padding: 14
  },
  waitingText: { color: "#1e40af", fontSize: 14, flex: 1 }
});
