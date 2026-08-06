import { registerWebModule, NativeModule } from "expo";
import type { PinnedHttpClient, PinnedHttpResponse } from "@vitana/shared";

/**
 * The web preview has no way to pin a public key, so it reports that instead of pretending.
 *
 * The previous stub had no methods at all, which turned any call into a `TypeError` about an
 * undefined function - a message that says nothing about the actual reason.
 */
class VitanaPinnedHttpModule extends NativeModule<{}> implements PinnedHttpClient {
  async request(): Promise<PinnedHttpResponse> {
    throw Object.assign(new Error("Certificate pinning is not available in the web preview."), {
      code: "platform-unsupported"
    });
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

export default registerWebModule(VitanaPinnedHttpModule, "VitanaPinnedHttpModule");
