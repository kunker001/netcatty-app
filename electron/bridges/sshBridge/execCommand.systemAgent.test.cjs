const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createExecCommandApi } = require("./execCommand.cjs");

function createHarness({ identitiesOnly }) {
  const preparedAgent = { kind: "system-agent" };
  const calls = {
    connectOptions: null,
    defaultKeyScans: 0,
    identityFileLoads: 0,
    inlineKeyLoads: 0,
    endCount: 0,
    authConfig: null,
    agentSocketChecks: 0,
  };

  class MockSSHClient extends EventEmitter {
    connect(options) {
      calls.connectOptions = options;
      queueMicrotask(() => this.emit("error", new Error("stop after options capture")));
    }

    end() {
      calls.endCount += 1;
    }

    exec() {}
  }

  const api = createExecCommandApi({
    SSHClient: MockSSHClient,
    NetcattyAgent: class {},
    randomUUID: () => "exec-test",
    console,
    setTimeout,
    clearTimeout,
    Error,
    prepareSystemSshAgentForAuth: async (payload) => {
      if (payload.useSshAgent !== true) return null;
      assert.equal(payload.useSshAgent, true);
      assert.equal(payload.identitiesOnly, identitiesOnly);
      return preparedAgent;
    },
    getAvailableAgentSocket: async () => {
      calls.agentSocketChecks += 1;
      return null;
    },
    findAllDefaultPrivateKeysFromHelper: async () => {
      calls.defaultKeyScans += 1;
      return [{ privateKey: "default-key" }];
    },
    preparePrivateKeyForAuth: async () => {
      calls.inlineKeyLoads += 1;
      return { privateKey: "inline-key" };
    },
    loadIdentityFileForAuth: async () => {
      calls.identityFileLoads += 1;
      return { privateKey: "identity-file-key" };
    },
    isPassphraseCancelledError: () => false,
    resolveSshConnectionTimeouts: () => ({
      tcpConnectTimeoutMs: 20000,
      authReadyTimeoutMs: 120000,
    }),
    buildAlgorithms: () => undefined,
    buildAuthHandler: (options) => {
      calls.authConfig = options;
      return { authHandler: ["agent"], agent: options.agent };
    },
    applyAuthToConnOpts: (connectOptions, authConfig) => {
      connectOptions.agent = authConfig.agent;
      connectOptions.authHandler = authConfig.authHandler;
    },
    createKeyboardInteractiveHandler: () => () => {},
  });

  return { api, calls, preparedAgent };
}

test("execCommand disables an unavailable optional agent before automatic fallback", async () => {
  const { api, calls } = createHarness({ identitiesOnly: false });

  await assert.rejects(
    () => api.execCommand(
      { sender: {} },
      {
        hostname: "example.test",
        username: "alice",
        command: "true",
        authMethod: "auto",
        password: "fallback-password",
        enableKeyboardInteractive: true,
        timeout: 10,
      },
    ),
    /stop after options capture/,
  );

  assert.equal(calls.agentSocketChecks, 1);
  assert.equal(calls.authConfig.sshAgentSocketOverride, null);
});

for (const identitiesOnly of [true, false]) {
  test(`execCommand uses the system agent without reading private keys (identitiesOnly=${identitiesOnly})`, async () => {
    const { api, calls, preparedAgent } = createHarness({ identitiesOnly });

    await assert.rejects(
      () => api.execCommand(
        { sender: {} },
        {
          hostname: "example.test",
          username: "alice",
          command: "true",
          privateKey: "encrypted-inline-key",
          identityFilePaths: ["/keys/encrypted-key"],
          useSshAgent: true,
          identitiesOnly,
          enableKeyboardInteractive: true,
          timeout: 10,
        },
      ),
      /stop after options capture/,
    );

    assert.equal(calls.inlineKeyLoads, 0);
    assert.equal(calls.identityFileLoads, 0);
    assert.equal(calls.defaultKeyScans, identitiesOnly ? 0 : 1);
    assert.equal(calls.authConfig.agent, preparedAgent);
    assert.deepEqual(calls.authConfig.defaultKeys, identitiesOnly ? [] : [{ privateKey: "default-key" }]);
    assert.equal(calls.connectOptions.agent, preparedAgent);
    assert.deepEqual(calls.connectOptions.authHandler, ["agent"]);
    assert.equal(calls.endCount, 1);
  });
}
