import os from "node:os";

export function getLanIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const ifaceList of Object.values(interfaces)) {
    for (const iface of ifaceList ?? []) {
      if (!iface.internal && iface.family === "IPv4") {
        return iface.address;
      }
    }
  }
  return null;
}

export function isLoopbackAddress(address: string): boolean {
  return (
    address === "::1" ||
    address.startsWith("127.") ||
    address.startsWith("::ffff:127.") ||
    address === "::ffff:7f00:1"
  );
}
