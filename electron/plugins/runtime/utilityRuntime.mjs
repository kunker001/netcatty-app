import { register } from "node:module";
import process from "node:process";

function messageData(value) {
  return value && typeof value === "object" && "data" in value ? value.data : value;
}

const bootstrap = await new Promise((resolve) => {
  process.parentPort.once("message", (event) => resolve(messageData(event)));
});
if (bootstrap?.type !== "netcatty-plugin:bootstrap") {
  throw new Error("Missing plugin utility runtime bootstrap");
}
register(new URL("./pluginModuleLoader.mjs", import.meta.url), {
  parentURL: import.meta.url,
  data: { mappings: bootstrap.config.moduleMappings },
});
const { startPluginRuntime } = await import("./runtimePeer.mjs");
await startPluginRuntime({
  port: process.parentPort,
  config: bootstrap.config,
  loadPlugin: (entryUrl) => import(entryUrl),
});
process.parentPort.postMessage({ type: "netcatty-plugin:ready" });
