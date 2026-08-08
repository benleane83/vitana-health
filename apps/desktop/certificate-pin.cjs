const { X509Certificate } = require("node:crypto");

function normalizeFingerprint(value) {
  return typeof value === "string" ? value.replace(/[^a-f0-9]/gi, "").toLowerCase() : "";
}

function getFingerprint256(certificate) {
  if (typeof certificate?.fingerprint256 === "string") return certificate.fingerprint256;
  if (!certificate?.data) return "";
  try {
    return new X509Certificate(certificate.data).fingerprint256;
  } catch {
    return "";
  }
}

function certificateMatchesPin(request, expectedFingerprint) {
  if (request.hostname !== "127.0.0.1" && request.hostname !== "localhost") return false;
  const expected = normalizeFingerprint(expectedFingerprint);
  return expected.length === 64 && normalizeFingerprint(getFingerprint256(request.certificate)) === expected;
}

module.exports = { certificateMatchesPin };
