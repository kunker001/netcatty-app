"use strict";

const { ipcRenderer } = require("electron");

let hostPort;
let runtimeReady = false;

function connectRuntime() {
  if (!hostPort || !runtimeReady) return;
  const port = hostPort;
  hostPort = undefined;
  window.postMessage({
    type: "netcatty-plugin:connect",
    runtimeToken: window.location.hostname,
  }, "*", [port]);
}

window.addEventListener("message", (event) => {
  if (event.data?.runtimeToken !== window.location.hostname) return;
  if (event.data?.type === "netcatty-plugin:runtime-ready") {
    runtimeReady = true;
    connectRuntime();
  } else if (event.data?.type === "netcatty-plugin:runtime-connected") {
    ipcRenderer.send("netcatty-plugin:runtime-connected");
  }
});

ipcRenderer.once("netcatty-plugin:connect", (event) => {
  hostPort = event.ports?.[0];
  connectRuntime();
});
ipcRenderer.send("netcatty-plugin:preload-ready");
