const assert = require("node:assert/strict");
const { X509Certificate } = require("node:crypto");
const { test } = require("node:test");
const { rootCertificates } = require("node:tls");
const { certificateMatchesPin } = require("./certificate-pin.cjs");

const fingerprint = "AA:" + "11:".repeat(30) + "BB";

test("accepts only the pinned certificate on loopback", () => {
  assert.equal(certificateMatchesPin({
    hostname: "127.0.0.1",
    certificate: { fingerprint256: fingerprint.toLowerCase() }
  }, fingerprint), true);
  assert.equal(certificateMatchesPin({
    hostname: "localhost",
    certificate: { fingerprint: "CC:" + "22:".repeat(30) + "DD" }
  }, fingerprint), false);
  assert.equal(certificateMatchesPin({
    hostname: "192.168.1.20",
    certificate: { fingerprint256: fingerprint }
  }, fingerprint), false);
  assert.equal(certificateMatchesPin({ hostname: "localhost", certificate: {} }, fingerprint), false);
});

test("derives the SHA-256 pin from Electron certificate data when fingerprint256 is absent", () => {
  const certificateData = rootCertificates[0];
  const fingerprint256 = new X509Certificate(certificateData).fingerprint256;

  assert.equal(certificateMatchesPin({
    hostname: "127.0.0.1",
    certificate: { data: certificateData, fingerprint: "00:".repeat(20).slice(0, -1) }
  }, fingerprint256), true);
});
