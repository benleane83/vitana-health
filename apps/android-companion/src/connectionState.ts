import { ApiError } from "@local-fitness-advisor/api-client";

export type ConnectionState =
  | "unpaired"
  | "connecting"
  | "online"
  | "maintenance"
  | "re-pair-required"
  | "unreachable";

export function connectionStateForError(caught: unknown): Exclude<ConnectionState, "unpaired" | "connecting" | "online"> {
  if (caught instanceof ApiError && caught.status === 503) return "maintenance";
  if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) return "re-pair-required";
  return "unreachable";
}
