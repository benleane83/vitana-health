/**
 * The Android implementation of the shared pinned-HTTP contract.
 *
 * The types live in `@vitana/shared` so an iOS implementation of this same native module has a
 * written specification to satisfy - including the error codes it must reject with.
 */
export type {
  PinnedHttpClient,
  PinnedHttpErrorCode,
  PinnedHttpRequest,
  PinnedHttpResponse
} from "@vitana/shared";
