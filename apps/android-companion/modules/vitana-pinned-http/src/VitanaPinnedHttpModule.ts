import { NativeModule, requireNativeModule } from "expo";

declare class VitanaPinnedHttpModule extends NativeModule<{}> {
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    publicKeyHash: string,
    timeoutMs?: number
  ): Promise<{ status: number; body: string; headers: Record<string, string> }>;
}

export default requireNativeModule<VitanaPinnedHttpModule>("VitanaPinnedHttp");
