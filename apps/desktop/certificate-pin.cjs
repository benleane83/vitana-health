function normalizeFingerprint(value) {
  return typeof value === "string" ? value.replace(/[^a-f0-9]/gi, "").toLowerCase() : "";
}

function certificateMatchesPin(request, expectedFingerprint) {
  if (request.hostname !== "127.0.0.1" && request.hostname !== "localhost") return false;
  const actualFingerprint = request.certificate?.fingerprint256 ?? request.certificate?.fingerprint;
  const expected = normalizeFingerprint(expectedFingerprint);
  return expected.length === 64 && normalizeFingerprint(actualFingerprint) === expected;
}

module.exports = { certificateMatchesPin };
