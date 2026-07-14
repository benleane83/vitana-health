import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type LookupAddress = { address: string; family: number };
type LookupAll = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;

export type CloudModelKind = "anthropic" | "azure" | "bedrock" | "openai" | "openrouter";

export class ModelEndpointPolicyError extends Error {
  readonly status = 400;
}

export function validateModelEndpoint(provider: "ollama" | "openai", endpoint: string): URL {
  const url = new URL(endpoint);
  if (url.username || url.password) {
    throw new ModelEndpointPolicyError("Model endpoints must not contain embedded credentials.");
  }
  if (provider === "ollama") {
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !isLoopbackHostname(url.hostname)) {
      throw new ModelEndpointPolicyError("Ollama endpoints must use HTTP or HTTPS on this computer.");
    }
    return url;
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new ModelEndpointPolicyError("Cloud model endpoints must use HTTPS on the standard port.");
  }
  cloudModelKind(url.hostname);
  return url;
}

export function cloudModelKind(hostname: string): CloudModelKind {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "openrouter.ai") return "openrouter";
  if (host === "api.openai.com") return "openai";
  if (host === "api.anthropic.com") return "anthropic";
  if (
    hasDomainSuffix(host, "services.ai.azure.com") ||
    hasDomainSuffix(host, "inference.ai.azure.com") ||
    hasDomainSuffix(host, "openai.azure.com") ||
    hasDomainSuffix(host, "cognitiveservices.azure.com")
  ) {
    return "azure";
  }
  if (/^bedrock-runtime(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(host)) return "bedrock";
  throw new ModelEndpointPolicyError(
    "Cloud model endpoint host is not supported. Use OpenRouter, OpenAI, Anthropic, Azure AI Foundry, Azure OpenAI, or AWS Bedrock Runtime."
  );
}

export async function assertSafeCloudModelEndpoint(endpoint: string, resolve: LookupAll = lookup): Promise<CloudModelKind> {
  const url = validateModelEndpoint("openai", endpoint);
  let addresses: LookupAddress[];
  try {
    addresses = await resolve(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ModelEndpointPolicyError("Cloud model endpoint hostname could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ModelEndpointPolicyError("Cloud model endpoint resolved to a local, private, link-local, or reserved address.");
  }
  return cloudModelKind(url.hostname);
}

function hasDomainSuffix(hostname: string, suffix: string): boolean {
  return hostname.endsWith(`.${suffix}`) && hostname.length > suffix.length + 1;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) !== 6) return false;
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPublicIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function isPublicIpv4(address: string): boolean {
  const [first, second, third] = address.split(".").map(Number);
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}