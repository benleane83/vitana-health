import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { getDeviceId, saveConnection } from "./endpointStore";
import { pinnedFetch } from "./pinnedFetch";
import { Button, Card, Message } from "./ui/components";
import { colors, radii, spacing, type } from "./ui/theme";

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
  const [cameraPermission, requestCameraPermission, getCameraPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraInstance, setCameraInstance] = useState(0);
  const scannedRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    void getCameraPermission();
  }, [getCameraPermission]);

  useEffect(() => {
    if (cameraPermission?.granted) {
      setCameraError("");
      setCameraReady(false);
    }
  }, [cameraPermission?.granted]);

  async function handleCameraPermissionRequest() {
    const permission = await requestCameraPermission();
    if (permission.granted) return;
    await getCameraPermission();
  }

  function handleQrScanned(data: string) {
    if (scannedRef.current || status !== "idle") return;
    scannedRef.current = true;
    try {
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (payload.app !== "local-fitness-advisor") throw new Error("This QR code is not a Local Fitness Advisor pairing code.");
      if (typeof payload.url !== "string" || typeof payload.pairingCode !== "string") {
        throw new Error("This pairing QR code is incomplete. Refresh it in the web app and try again.");
      }
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the QR code. Aim at the pairing QR code shown in the web app.");
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
    setCameraReady(false);
    setCameraError("");
    setCameraInstance((current) => current + 1);
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
              Open the web app, go to Import → Sync, and scan the QR code shown there.
            </Text>
            {status === "idle" ? (
              cameraPermission === null ? (
                <View style={styles.permissionCard}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.permissionText}>Checking camera access…</Text>
                </View>
              ) : cameraPermission.granted ? (
                <View style={styles.cameraContainer}>
                  {!cameraReady && !cameraError ? (
                    <View style={styles.cameraLoading}>
                      <ActivityIndicator color={colors.onAccent} />
                      <Text style={styles.cameraLoadingText}>Starting camera…</Text>
                    </View>
                  ) : null}
                  <CameraView
                    key={cameraInstance}
                    style={styles.camera}
                    facing="back"
                    active={!cameraError}
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onCameraReady={() => setCameraReady(true)}
                    onMountError={({ message }) => {
                      setCameraReady(false);
                      setCameraError(message || "The camera could not be started.");
                    }}
                    onBarcodeScanned={({ data }) => handleQrScanned(data)}
                  />
                  {cameraError ? (
                    <View style={styles.cameraError}>
                      <Text style={styles.cameraErrorText}>{cameraError}</Text>
                      <Button secondary onPress={retryCurrentMode}>Restart camera</Button>
                    </View>
                  ) : null}
                </View>
              ) : (
                <Card>
                  <Text style={styles.permissionText}>Camera access is needed to scan the QR code.</Text>
                  {cameraPermission.canAskAgain ? (
                    <Button onPress={() => { void handleCameraPermissionRequest(); }}>Grant camera permission</Button>
                  ) : (
                    <Button onPress={() => { void Linking.openSettings(); }}>Open app settings</Button>
                  )}
                </Card>
              )
            ) : null}
        </View>

        {message ? (
          <Message title={isError ? "Could not pair" : status === "approved" ? "Phone paired" : "Pairing status"} detail={message} tone={isError ? "danger" : status === "approved" ? "success" : "info"} />
        ) : null}

        {status === "detected" ? (
          <Button onPress={() => { void handleConnect(); }}>Connect and pair</Button>
        ) : null}

        {status === "waiting" ? (
          <View style={styles.waitingCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.waitingText}>
              Approve the pairing request in the web app on your PC.
            </Text>
          </View>
        ) : null}

        {isError ? (
          <Button onPress={retryCurrentMode}>Try again</Button>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { gap: spacing.md, padding: spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.textStrong, fontSize: type.heading, fontWeight: "800" },
  cancelButton: { paddingHorizontal: 12, paddingVertical: 6 },
  cancelText: { color: colors.primary, fontSize: type.body, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: type.body, lineHeight: 21 },
  section: { gap: spacing.md },
  instructions: { color: colors.muted, fontSize: type.body, lineHeight: 21 },
  cameraContainer: { height: 280, borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.textStrong },
  camera: { flex: 1 },
  cameraLoading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: spacing.sm, zIndex: 1 },
  cameraLoadingText: { color: colors.onAccent, fontSize: type.body },
  cameraError: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.textStrong },
  cameraErrorText: { color: colors.onAccent, fontSize: type.body, textAlign: "center" },
  permissionCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md
  },
  permissionText: { color: colors.text, fontSize: type.body, lineHeight: 21 },
  waitingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.infoMuted,
    borderRadius: radii.md,
    padding: spacing.md
  },
  waitingText: { color: colors.info, fontSize: type.body, flex: 1, lineHeight: 21 }
});
