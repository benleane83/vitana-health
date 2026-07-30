import { NativeModule, requireNativeModule } from "expo";
import type { PinnedHttpClient, PinnedHttpResponse } from "@vitana/shared";

// `PinnedHttpClient` is the platform-neutral contract; the declaration below is Android's binding
// to it. Widening this signature without widening the contract is what a Swift port would trip on.
declare class VitanaPinnedHttpModule extends NativeModule<{}> implements PinnedHttpClient {
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    publicKeyHash: string,
    timeoutMs?: number,
    requestId?: string | null
  ): Promise<PinnedHttpResponse>;
  /** Cancels an in-flight request by the id passed to `request`. Unknown ids are ignored. */
  cancel(requestId: string): Promise<boolean>;
}

export default requireNativeModule<VitanaPinnedHttpModule>("VitanaPinnedHttp");
