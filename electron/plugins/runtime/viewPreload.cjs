"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  if (typeof listener !== "function") throw new TypeError("Plugin view listener must be a function");
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return Object.freeze({ dispose: () => ipcRenderer.removeListener(channel, handler) });
}

const ENVIRONMENT_CHANNEL = "netcatty-plugin-view:environment";
const environmentListeners = new Set();
let latestEnvironment;
let environmentGeneration = 0;
let initialEnvironmentRequest;

function publishEnvironment(value) {
  latestEnvironment = value;
  environmentGeneration += 1;
  for (const listener of environmentListeners) listener(value);
}

ipcRenderer.on(ENVIRONMENT_CHANNEL, (_event, value) => publishEnvironment(value));

function subscribeEnvironment(listener) {
  if (typeof listener !== "function") throw new TypeError("Plugin view listener must be a function");
  environmentListeners.add(listener);
  if (latestEnvironment !== undefined) {
    const value = latestEnvironment;
    const generation = environmentGeneration;
    queueMicrotask(() => {
      if (environmentListeners.has(listener) && generation === environmentGeneration) listener(value);
    });
  } else if (!initialEnvironmentRequest) {
    initialEnvironmentRequest = ipcRenderer.invoke("netcatty-plugin-view:get-environment")
      .then((value) => {
        if (latestEnvironment === undefined) publishEnvironment(value);
      })
      .catch(() => {})
      .finally(() => { initialEnvironmentRequest = undefined; });
  }
  return Object.freeze({ dispose: () => environmentListeners.delete(listener) });
}

contextBridge.exposeInMainWorld("netcattyView", Object.freeze({
  postMessage(message) {
    return ipcRenderer.invoke("netcatty-plugin-view:post-message", message);
  },
  executeCommand(command, args) {
    return ipcRenderer.invoke("netcatty-plugin-view:execute-command", { command, args });
  },
  getState() {
    return ipcRenderer.invoke("netcatty-plugin-view:get-state");
  },
  setState(state) {
    return ipcRenderer.invoke("netcatty-plugin-view:set-state", state);
  },
  onDidReceiveMessage(listener) {
    return subscribe("netcatty-plugin-view:message", listener);
  },
  onDidChangeEnvironment(listener) {
    return subscribeEnvironment(listener);
  },
}));
