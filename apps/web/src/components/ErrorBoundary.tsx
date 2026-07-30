import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** Shown above the error text, e.g. "Track" or "Vitana Health". */
  label: string;
  children: ReactNode;
  /** Called when the user asks to retry, before the boundary resets. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error?: Error;
}

/**
 * Catches render-time failures so a single bad row of health data cannot blank the whole app.
 *
 * React unmounts the entire tree when a render throws and nothing catches it, which for a
 * local-first app looks identical to data loss. Wrapping each route panel means the failure is
 * contained to that panel and the user can still reach their other data.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Health data never leaves the device, so this stays on the console for the user to copy
    // into a bug report rather than being reported anywhere.
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: undefined });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="panel error-boundary" role="alert">
        <h2>{this.props.label} could not be displayed</h2>
        <p className="empty">
          Something went wrong while rendering this view. Your health data has not been changed.
        </p>
        <pre className="error-boundary-detail">{error.message}</pre>
        <button type="button" className="secondary" onClick={this.reset}>
          Try again
        </button>
      </section>
    );
  }
}
