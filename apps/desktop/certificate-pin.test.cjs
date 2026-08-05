const assert = require("node:assert/strict");
const { test } = require("node:test");
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
