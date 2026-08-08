import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { companionDeviceName } from "./deviceName";
import { getDeviceId, saveConnection } from "./endpointStore";
import { parsePairingPayload, type PairingPayload } from "./pairingPayload";
import { pinnedFetch } from "./pinnedFetch";
import { Button, Card, Message } from "./ui/components";
import { colors, radii, spacing, type } from "./ui/theme";
import { userFacingError } from "./userFacingError";

type PairStatus = "idle" | "detected" | "requesting" | "waiting" | "approved" | "denied" | "error";

export interface PairResult {
  url: string;
  token: string | null;
  publicKeyHash: string | null;
}

export function PairScreen({
  onComplete,
  onCancel,
  initialPayload
}: {
  onComplete: (result: PairResult) => void;
  onCancel: () => void;
  initialPayload?: PairingPayload;
}) {
  const [status, setStatus] = useState<PairStatus>("idle");
  const [message, setMessage] = useState("");
  const [detectedUrl, setDetectedUrl] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [publicKeyHash, setPublicKeyHash] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [cameraPermission, requestCameraPermission, getCameraPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraInstance, setCameraInstance] = useState(0);
  const scannedRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
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

  useEffect(() => {
    if (!initialPayload || status !== "idle") return;
    scannedRef.current = true;
    setDetectedUrl(initialPayload.url);
    setPairingCode(initialPayload.pairingCode);
    setPublicKeyHash(initialPayload.publicKeyHash);
    setStatus("detected");
    setMessage(`Found server: ${initialPayload.url}`);
  }, [initialPayload, status]);

  async function handleCameraPermissionRequest() {
    const permission = await requestCameraPermission();
    if (permission.granted) return;
    await getCameraPermission();
  }

  function handleQrScanned(data: string) {
    if (scannedRef.current || status !== "idle") return;
    scannedRef.current = true;
    try {
      const payload = parsePairingPayload(data, !__DEV__);
      const { url } = payload;
      setDetectedUrl(url);
      setPairingCode(payload.pairingCode);
      setPublicKeyHash(payload.publicKeyHash);
      setStatus("detected");
      setMessage(`Found server: ${url}`);
    } catch (error) {
      setMessage(userFacingError(error, "Could not read the QR code. Aim at the pairing QR code shown in the web app."));
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
        body: JSON.stringify({ deviceId, deviceName: companionDeviceName(Platform.OS), pairingCode })
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "The paired PC rejected the pairing request.");
      }

      if (body.status === "approved" && typeof body.token === "string") {
        await saveConnection({
          url: detectedUrl,
          token: body.token,
          publicKeyHash,
          pairedAt: new Date().toISOString(),
          pairingId: typeof body.id === "string" ? body.id : null,
          serverInstanceId: null,
          profileId: null
        });
        setStatus("approved");
        setMessage("Paired successfully! Returning to sync screen…");
        pollTimeoutRef.current = setTimeout(
          () => onComplete({ url: detectedUrl, token: body.token as string, publicKeyHash }),
          1500
        );
        return;
      }

      if (typeof body.pairingId === "string") {
        setStatus("waiting");
        setMessage("Waiting for approval in the web app on your PC. This phone will check again every 5 seconds for up to 5 minutes.");
        setPollAttempt(0);
        if (typeof body.pollingSecret !== "string") throw new Error("Pairing response did not include a polling secret.");
        pollForApproval(detectedUrl, body.pairingId, body.pollingSecret, publicKeyHash);
      } else {
        setStatus("error");
        setMessage(typeof body.error === "string" ? body.error : "Pairing request failed.");
      }
    } catch (error) {
      setStatus("error");
      setMessage(userFacingError(error, "Connection failed. Check the PC is running and reachable on your local network."));
    }
  }

  function pollForApproval(url: string, pairingId: string, pollingSecret: string, pinnedHash: string | null) {
    let attempts = 0;
    const maxAttempts = 60;

    function scheduleNext() {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = setTimeout(() => { void poll(); }, 5000);
    }

    async function poll() {
      if (cancelledRef.current || attempts >= maxAttempts) {
        if (!cancelledRef.current) {
          setStatus("error");
          setMessage("Pairing timed out. Approve the request in the web app and try again.");
        }
        return;
      }
      attempts++;
      setPollAttempt(attempts);
      try {
        const response = await pinnedFetch(`${url}/api/pairing/status/${pairingId}`, pinnedHash, {
          headers: { Accept: "application/json", "x-pairing-secret": pollingSecret }
        });
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (cancelledRef.current) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            cancelledRef.current = true;
            setStatus("error");
            setMessage("This pairing request is no longer valid. Scan a new pairing QR code.");
            return;
          }
          scheduleNext();
          return;
        }
        if (body.status === "approved" && typeof body.token === "string") {
          cancelledRef.current = true;
          if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
          await saveConnection({
            url,
            token: body.token,
            publicKeyHash: pinnedHash,
            pairedAt: new Date().toISOString(),
            pairingId,
            serverInstanceId: null,
            profileId: null
          });
          setStatus("approved");
          setMessage("Paired successfully! Returning to sync screen…");
          pollTimeoutRef.current = setTimeout(() => onComplete({ url, token: body.token as string, publicKeyHash: pinnedHash }), 1500);
        } else if (body.status === "denied") {
          cancelledRef.current = true;
          if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
          setStatus("denied");
          setMessage("Pairing was denied on the PC. Ask the user to approve and try again.");
        } else {
          scheduleNext();
        }
      } catch {
        if (!cancelledRef.current) scheduleNext();
      }
    }

    void poll();
  }

  function retryCurrentMode() {
    cancelledRef.current = false;
    scannedRef.current = false;
    setStatus("idle");
    setMessage("");
    setDetectedUrl("");
    setPairingCode("");
    setPublicKeyHash(null);
    setPollAttempt(0);
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

        <Text style={styles.subtitle}>Connect to a Vitana instance running on your network.</Text>

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
            <View style={styles.waitingText}>
              <Text style={styles.waitingTitle}>Waiting for approval</Text>
              <Text style={styles.waitingDetail}>Approve the request in the web app on your PC. Check {pollAttempt || 1} of 60.</Text>
            </View>
          </View>
        ) : null}

        {status === "requesting" ? (
          <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.waitingCard}>
            <ActivityIndicator color={colors.primary} />
            <View style={styles.waitingText}>
              <Text style={styles.waitingTitle}>Contacting your PC</Text>
              <Text style={styles.waitingDetail}>Sending the secure pairing request.</Text>
            </View>
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
  waitingText: { flex: 1, gap: 2 },
  waitingTitle: { color: colors.info, fontSize: type.body, fontWeight: "700" },
  waitingDetail: { color: colors.info, fontSize: type.body, lineHeight: 21 }
});
