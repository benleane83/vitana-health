import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProfileLifecycle } from "./useProfileLifecycle.js";
import { api } from "../../api.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function bootstrapFor(profileId: string) {
  return { profile: { id: profileId, displayName: profileId } } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProfileLifecycle", () => {
  it("ignores a superseded profile load so one family member's data cannot render under another", async () => {
    const slow = defer<unknown>();
    const bootstrap = vi.spyOn(api, "bootstrap")
      .mockImplementationOnce(() => slow.promise as never)
      .mockImplementation(() => Promise.resolve(bootstrapFor("profile-b")) as never);
    vi.spyOn(api, "analytics").mockResolvedValue({} as never);
    vi.spyOn(api.profiles, "list").mockResolvedValue({
      profiles: [],
      activeProfileId: "profile-b"
    } as never);

    const { result } = renderHook(() => useProfileLifecycle(() => undefined, async () => true));
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1));

    // The user switches while the first load is still in flight.
    const second = result.current.refresh();
    slow.resolve(bootstrapFor("profile-a"));
    await second;

    await waitFor(() => expect(result.current.bootstrap?.profile.id).toBe("profile-b"));
    // Let the stale promise settle, then confirm it never overwrote the newer snapshot.
    await Promise.resolve();
    expect(result.current.bootstrap?.profile.id).toBe("profile-b");
  });

  it("aborts the in-flight load when a newer one starts", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    vi.spyOn(api, "bootstrap").mockImplementation((signal?: AbortSignal) => {
      signals.push(signal);
      return Promise.resolve(bootstrapFor("profile-a")) as never;
    });
    vi.spyOn(api, "analytics").mockResolvedValue({} as never);
    vi.spyOn(api.profiles, "list").mockResolvedValue({ profiles: [] } as never);

    const { result } = renderHook(() => useProfileLifecycle(() => undefined, async () => true));
    await waitFor(() => expect(signals).toHaveLength(1));

    await result.current.refresh();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});
