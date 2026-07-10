declare module "react-native-zeroconf" {
  interface ResolvedService {
    name: string;
    host: string;
    port: number;
    addresses: string[];
    txt?: Record<string, string>;
  }

  interface RemovedService {
    name: string;
  }

  class Zeroconf {
    scan(type: string, protocol?: string, domain?: string): void;
    stop(): void;
    on(event: "resolved", listener: (service: ResolvedService) => void): this;
    on(event: "removed", listener: (service: RemovedService) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    removeDeviceListeners(): void;
    removeAllListeners(): void;
  }

  export default Zeroconf;
}
