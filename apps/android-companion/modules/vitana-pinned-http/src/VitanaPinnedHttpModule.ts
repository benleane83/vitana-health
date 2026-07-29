import { NativeModule, requireNativeModule } from "expo";

declare class VitanaPinnedHttpModule extends NativeModule<{}> {
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    publicKeyHash: string,
    timeoutMs?: number,
    requestId?: string | null
  ): Promise<{ status: number; body: string; headers: Record<string, string> }>;
  /** Cancels an in-flight request by the id passed to `request`. Unknown ids are ignored. */
  cancel(requestId: string): Promise<boolean>;
}

export default requireNativeModule<VitanaPinnedHttpModule>("VitanaPinnedHttp");
