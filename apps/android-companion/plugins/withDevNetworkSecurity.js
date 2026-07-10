const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

function withDevNetworkSecurity(config, options = {}) {
  const allowCleartext = options.allowCleartext === true;
  const networkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="${allowCleartext ? "true" : "false"}" />
</network-security-config>
`;
  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("Unable to find Android application manifest entry.");
    }

    application.$ = application.$ || {};
    application.$["android:usesCleartextTraffic"] = allowCleartext ? "true" : "false";
    application.$["android:networkSecurityConfig"] = "@xml/network_security_config";

    return config;
  });

  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, "network_security_config.xml"), networkSecurityConfig);
      return config;
    }
  ]);

  return config;
}

module.exports = withDevNetworkSecurity;
