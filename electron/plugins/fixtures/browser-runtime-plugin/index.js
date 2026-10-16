import { definePlugin } from "@netcatty/plugin-sdk";

export default definePlugin({
  async activate(context) {
    for (const capability of [
      "fetch",
      "RTCPeerConnection",
      "WebSocket",
      "WebTransport",
      "Worker",
    ]) {
      if (globalThis[capability] !== undefined) {
        throw new Error(`Direct browser capability remains exposed: ${capability}`);
      }
    }
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    let childNetworkBlocked = false;
    try {
      await iframe.contentWindow.fetch("https://netcatty-plugin-smoke.invalid/");
    } catch {
      childNetworkBlocked = true;
    } finally {
      iframe.remove();
    }
    if (!childNetworkBlocked) {
      throw new Error("Child browsing context bypassed the offline plugin session");
    }
    await context.storage.set("smoke.activation", { kind: "browser", ready: true });
  },
});
