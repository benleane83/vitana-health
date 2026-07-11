import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { getDeviceId, saveConnection } from "./endpointStore";
import { pinnedFetch } from "./pinnedFetch";

type PairStatus = "idle" | "detected" | "requesting" | "waiting" | "approved" | "denied" | "error";

export interface PairResult {
  url: string;
  token: string | null;
  publicKeyHash: string | null;
}

export function PairScreen({
  onComplete,
  onCancel
}: {
  onComplete: (result: PairResult) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<PairStatus>("idle");
  const [message, setMessage] = useState("");
  const [detectedUrl, setDetectedUrl] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [publicKeyHash, setPublicKeyHash] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  function handleQrScanned(data: string) {
    if (scannedRef.current || status !== "idle") return;
    scannedRef.current = true;
    try {
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (
        typeof payload.url === "string" &&
        typeof payload.pairingCode === "string" &&
        payload.app === "local-fitness-advisor"
      ) {
        const url = payload.url.replace(/\/+$/, "");
        if (!__DEV__ && !url.startsWith("https://")) {
          throw new Error("Production pairing requires HTTPS.");
        }
        if (url.startsWith("https://") && typeof payload.publicKeyHash !== "string") {
          throw new Error("This pairing code does not include a server identity.");
        }
        setDetectedUrl(url);
        setPairingCode(payload.pairingCode);
        setPublicKeyHash(typeof payload.publicKeyHash === "string" ? payload.publicKeyHash : null);
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

  async function handleConnect() {
    if (!detectedUrl || !pairingCode) {
      setStatus("error");
      setMessage("Scan the server QR code to obtain a short-lived pairing code.");
      return;
    }
    setStatus("requesting");
    setMessage("Sending pairing request…");
    try {
      const deviceId = await getDeviceId();
      const response = await pinnedFetch(`${detectedUrl}/api/pairing/request`, publicKeyHash, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ deviceId, deviceName: "Android Companion", pairingCode })
      });
      const body = (await response.json()) as Record<string, unknown>;

      if (body.status === "approved" && typeof body.token === "string") {
        await saveConnection({ url: detectedUrl, token: body.token, publicKeyHash, pairedAt: new Date().toISOString() });
        setStatus("approved");
        setMessage("Paired successfully! Returning to sync screen…");
        setTimeout(() => onComplete({ url: detectedUrl, token: body.token as string, publicKeyHash }), 1500);
        return;
      }

      if (typeof body.pairingId === "string") {
        setStatus("waiting");
        setMessage("Waiting for approval in the web app on your PC…");
        if (typeof body.pollingSecret !== "string") throw new Error("Pairing response did not include a polling secret.");
        pollForApproval(detectedUrl, body.pairingId, body.pollingSecret, publicKeyHash);
      } else {
        setStatus("error");
        setMessage(typeof body.error === "string" ? body.error : "Pairing request failed.");
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Connection failed. Check the server is running and reachable on the network.");
    }
  }

  function pollForApproval(url: string, pairingId: string, pollingSecret: string, pinnedHash: string | null) {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60;

    function scheduleNext() {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = setTimeout(() => { void poll(); }, 5000);
    }

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
        const response = await pinnedFetch(`${url}/api/pairing/status/${pairingId}`, pinnedHash, {
          headers: { Accept: "application/json", "x-pairing-secret": pollingSecret }
        });
        const body = (await response.json()) as Record<string, unknown>;
        if (body.status === "approved" && typeof body.token === "string") {
          cancelled = true;
          if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
          await saveConnection({ url, token: body.token, publicKeyHash: pinnedHash, pairedAt: new Date().toISOString() });
          setStatus("approved");
          setMessage("Paired successfully! Returning to sync screen…");
          pollTimeoutRef.current = setTimeout(() => onComplete({ url, token: body.token as string, publicKeyHash: pinnedHash }), 1500);
        } else if (body.status === "denied") {
          cancelled = true;
          if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
          setStatus("denied");
          setMessage("Pairing was denied on the PC. Ask the user to approve and try again.");
        } else {
          scheduleNext();
        }
      } catch {
        scheduleNext();
      }
    }

    void poll();
  }

  function retryCurrentMode() {
    scannedRef.current = false;
    setStatus("idle");
    setMessage("");
    setDetectedUrl("");
    setPairingCode("");
    setPublicKeyHash(null);
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
