const assert = require("node:assert/strict");
const fs = require("node:fs");
const { mkdtempSync, readFileSync, rmSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { createXdgAutostartRegistration, quoteDesktopExecArgument } = require("./xdg-autostart.cjs");

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("creates, validates, updates, and removes an XDG autostart entry", () => {
  const root = mkdtempSync(path.join(tmpdir(), "vitana-xdg-autostart-"));
  roots.push(root);
  const writeModes = [];
  const registration = createXdgAutostartRegistration({
    executablePath: "/opt/Vitana Health/Vitana Health",
    environment: { XDG_CONFIG_HOME: root },
    fileSystem: {
      ...fs,
      writeFileSync: (filePath, contents, options) => {
        writeModes.push(options.mode);
        return fs.writeFileSync(filePath, contents, options);
      }
    }
  });

  assert.equal(registration.isEnabled(), false);
  registration.setEnabled(true);
  assert.equal(registration.isEnabled(), true);
  assert.match(readFileSync(registration.filePath, "utf8"), /^Exec="\/opt\/Vitana Health\/Vitana Health" --background$/m);
  assert.deepEqual(writeModes, [0o600]);
  if (process.platform !== "win32") {
    assert.equal(statSync(registration.filePath).mode & 0o777, 0o600);
  }

  registration.setEnabled(true);
  assert.equal(registration.isEnabled(), true);
  registration.setEnabled(false);
  assert.equal(registration.isEnabled(), false);
});

test("escapes desktop Exec metacharacters and rejects line injection", () => {
  assert.equal(quoteDesktopExecArgument("/opt/$Vitana`/app"), "\"/opt/\\$Vitana\\`/app\"");
  assert.throws(() => quoteDesktopExecArgument("/opt/app\nHidden=true"), /invalid/);
});
