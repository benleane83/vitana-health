import { ApiError } from "@vitana/api-client";

export type ConnectionState =
  | "unpaired"
  | "connecting"
  | "online"
  | "maintenance"
  | "re-pair-required"
  | "unreachable";

const connectionStateLabels: Record<ConnectionState, string> = {
  unpaired: "Not connected",
  connecting: "Connecting",
  online: "Connected",
  maintenance: "PC maintenance in progress",
  "re-pair-required": "Re-pair required",
  unreachable: "PC unavailable"
};

export function connectionStateLabel(state: ConnectionState): string {
  return connectionStateLabels[state];
}

export function connectionStateForError(caught: unknown): Exclude<ConnectionState, "unpaired" | "connecting" | "online"> {
  if (caught instanceof ApiError && caught.status === 503) return "maintenance";
  if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) return "re-pair-required";
  return "unreachable";
}
