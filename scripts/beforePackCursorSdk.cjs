const {
  buildWindowsHelloHelper,
  normalizeWindowsHelperArch,
} = require("./build-windows-hello-helper.cjs");

function beforePackCursorSdk(context = {}) {
  const projectDir = context.appDir || process.cwd();
  const platform = context.electronPlatformName || process.platform;
  const arch = normalizeWindowsHelperArch(context.arch || process.env.npm_config_arch || process.arch);
  const buildHelper = context.buildWindowsHelloHelper || buildWindowsHelloHelper;
  if (platform === "win32") {
    const result = buildHelper({ projectDir, platform, arch });
    if (result?.skipped) {
      throw new Error(`Windows Hello helper was not built: ${result.reason || "unknown"}`);
    }
  }
}

module.exports = beforePackCursorSdk;
module.exports.default = beforePackCursorSdk;
module.exports.beforePackCursorSdk = beforePackCursorSdk;
