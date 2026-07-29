import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { resetStandaloneStorage } from "./standalone/createStandaloneRepository";
import { clearConnection } from "./endpointStore";
import { Button, Screen } from "./ui/components";
import { colors, radii, spacing, type } from "./ui/theme";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error?: Error;
  resetting: boolean;
  resetFailed?: string;
}

/**
 * Last line of defence for the companion app.
 *
 * A render crash on a phone leaves a blank screen with no console and no way to recover, so the
 * boundary also exposes the escape hatch: clearing the local standalone store and the paired
 * connection returns the app to its first-run state without a reinstall. Nothing on the paired PC
 * is touched.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { resetting: false };

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[companion] render failed", error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState({ error: undefined, resetFailed: undefined });
  };

  private readonly resetLocalData = async (): Promise<void> => {
    this.setState({ resetting: true, resetFailed: undefined });
    try {
      await resetStandaloneStorage();
      await clearConnection();
      this.setState({ error: undefined, resetting: false });
    } catch (resetError: unknown) {
      this.setState({
        resetting: false,
        resetFailed: resetError instanceof Error ? resetError.message : "Unable to reset local data."
      });
    }
  };

  render(): ReactNode {
    const { error, resetting, resetFailed } = this.state;
    if (!error) return this.props.children;
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app hit an unexpected error. Your health data on this phone has not been changed.
          </Text>
          <View style={styles.detail}>
            <Text style={styles.detailText}>{error.message}</Text>
          </View>
          <Button onPress={this.retry}>Try again</Button>
          <Text style={styles.body}>
            If it keeps happening, clearing local data returns the app to its first-run state. You
            will need to pair with your PC again. Data stored on your PC is not affected.
          </Text>
          <Button
            secondary
            danger
            disabled={resetting}
            onPress={() => { void this.resetLocalData(); }}
          >
            {resetting ? "Clearing…" : "Clear local data"}
          </Button>
          {resetFailed ? <Text style={styles.error}>{resetFailed}</Text> : null}
        </ScrollView>
      </Screen>
    );
  }
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: type.heading, fontWeight: "600", color: colors.textStrong },
  body: { fontSize: type.body, color: colors.muted },
  detail: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md },
  detailText: { fontSize: type.label, color: colors.text },
  error: { fontSize: type.label, color: colors.danger }
});
