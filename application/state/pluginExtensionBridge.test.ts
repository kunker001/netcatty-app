import assert from "node:assert/strict";
import test from "node:test";
import { pluginExtensionBridge } from "./pluginExtensionBridge";

const setBridge = (bridge: Partial<NetcattyBridge> | undefined) => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { netcatty: bridge },
  });
};

test("plugin event subscriptions are inert when the desktop bridge is absent", () => {
  setBridge(undefined);
  const stopImporter = pluginExtensionBridge.onImporterProgress(() => {});
  const stopAuthentication = pluginExtensionBridge.onAuthenticationChallenge(() => {});
  const stopContributions = pluginExtensionBridge.onContributionsChanged(() => {});
  assert.equal(typeof stopImporter, "function");
  assert.equal(typeof stopAuthentication, "function");
  assert.equal(typeof stopContributions, "function");
  stopImporter();
  stopAuthentication();
  stopContributions();
});

test("plugin contribution change subscriptions forward desktop bridge events", () => {
  let subscribed: (() => void) | null = null;
  let disposed = false;
  setBridge({
    onPluginContributionsChanged: (listener) => {
      subscribed = listener;
      return () => { disposed = true; };
    },
  });

  let observed = 0;
  const unsubscribe = pluginExtensionBridge.onContributionsChanged(() => { observed += 1; });
  subscribed?.();
  assert.equal(observed, 1);
  unsubscribe();
  assert.equal(disposed, true);
});

test("plugin credential options follow only a successfully accepted secure catalog", async () => {
  const published: Array<ReadonlyArray<string>> = [];
  const unsubscribe = pluginExtensionBridge.subscribeCredentialCatalog(() => {
    published.push(pluginExtensionBridge.getCredentialCatalogIds());
  });
  setBridge({
    updatePluginCredentialCatalog: async (entries) => entries.length,
  });

  const entries = [
    { id: "credential-reference-0001", ciphertext: "enc:v1:Y2lwaGVy" },
    { id: "credential-reference-0002", ciphertext: "enc:v1:Y2lwaGVy" },
  ];
  assert.equal(await pluginExtensionBridge.updateCredentialCatalog(entries), 2);
  assert.deepEqual(pluginExtensionBridge.getCredentialCatalogIds(), entries.map((entry) => entry.id));
  assert.equal(Object.isFrozen(pluginExtensionBridge.getCredentialCatalogIds()), true);

  setBridge({});
  assert.equal(await pluginExtensionBridge.updateCredentialCatalog(entries), 0);
  assert.deepEqual(pluginExtensionBridge.getCredentialCatalogIds(), []);
  assert.deepEqual(published, [
    entries.map((entry) => entry.id),
    [],
  ]);

  setBridge({
    updatePluginCredentialCatalog: async (nextEntries) => nextEntries.length,
  });
  assert.equal(await pluginExtensionBridge.updateCredentialCatalog(entries), 2);
  setBridge({
    updatePluginCredentialCatalog: async () => {
      throw new Error("secure storage unavailable");
    },
  });
  await assert.rejects(
    pluginExtensionBridge.updateCredentialCatalog(entries),
    /secure storage unavailable/u,
  );
  assert.deepEqual(pluginExtensionBridge.getCredentialCatalogIds(), []);
  assert.deepEqual(published, [
    entries.map((entry) => entry.id),
    [],
    entries.map((entry) => entry.id),
    [],
  ]);
  unsubscribe();
});
