/**
 * Live + mock matrix for SSH MFA models related to #2150 / #2217.
 *
 * Always runs:
 *   - Mock models A / B / C / password-only against Netcatty-style auth ordering
 *     (credentials below are synthetic fixture strings, not real lab secrets)
 *
 * Optionally runs against a lab host when env is fully configured:
 *   SSH_MFA_LIVE=1
 *   SSH_MFA_HOST=...
 *   SSH_MFA_PORT=22 (optional)
 *   SSH_MFA_EDRPW_PASSWORD=...
 *   SSH_MFA_EDRTEST_PASSWORD=...
 *   SSH_MFA_EDRTEST_TOTP_SECRET=...
 *   SSH_MFA_EDRMIX_PASSWORD=...
 *   SSH_MFA_EDRMIX_TOTP_SECRET=...
 *   SSH_MFA_EDRSEC_PASSWORD=...
 *   SSH_MFA_EDRSEC_SECONDARY=...
 *
 * Usage:
 *   node --test electron/bridges/sshMfaModels.live.test.cjs
 *   SSH_MFA_LIVE=1 SSH_MFA_HOST=... ... node --test electron/bridges/sshMfaModels.live.test.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");

const LIVE_FLAG = process.env.SSH_MFA_LIVE === "1" || process.env.SSH_MFA_LIVE === "true";
const LIVE_HOST = process.env.SSH_MFA_HOST || "";
const LIVE_PORT = Number(process.env.SSH_MFA_PORT || 22);

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : "";
}

// Live credentials are NEVER hardcoded — supply via environment for private lab runs.
const LAB = {
  edrpw: {
    username: env("SSH_MFA_EDRPW_USER") || "edrpw",
    password: env("SSH_MFA_EDRPW_PASSWORD"),
    model: "password-only",
  },
  edrtest: {
    username: env("SSH_MFA_EDRTEST_USER") || "edrtest",
    password: env("SSH_MFA_EDRTEST_PASSWORD"),
    totpSecret: env("SSH_MFA_EDRTEST_TOTP_SECRET"),
    model: "B-dual-ki-totp",
  },
  edrmix: {
    username: env("SSH_MFA_EDRMIX_USER") || "edrmix",
    password: env("SSH_MFA_EDRMIX_PASSWORD"),
    totpSecret: env("SSH_MFA_EDRMIX_TOTP_SECRET"),
    model: "B-dual-ki-totp-alt",
  },
  edrsec: {
    username: env("SSH_MFA_EDRSEC_USER") || "edrsec",
    password: env("SSH_MFA_EDRSEC_PASSWORD"),
    secondaryPassword: env("SSH_MFA_EDRSEC_SECONDARY"),
    model: "B-dual-ki-secondary-password",
  },
};

function hasLiveCreds(entry) {
  if (!entry?.password) return false;
  if ("totpSecret" in entry && entry.model.includes("totp") && !entry.totpSecret) return false;
  if ("secondaryPassword" in entry && entry.model.includes("secondary") && !entry.secondaryPassword) return false;
  return true;
}

const LIVE = LIVE_FLAG && !!LIVE_HOST;

function base32Decode(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(secret).toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, atMs = Date.now(), stepSec = 30) {
  const key = base32Decode(secret);
  const counter = Math.floor(atMs / 1000 / stepSec);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

function isPasswordLikePrompt(prompt) {
  const p = String(prompt || "").toLowerCase();
  return p.includes("password") && !p.includes("secondary") && !p.includes("verification") && !p.includes("code");
}

function isSecondaryLikePrompt(prompt) {
  const p = String(prompt || "").toLowerCase();
  return (
    p.includes("secondary authentication")
    || p.includes("verification code")
    || p.includes("authentication code")
    || (p.includes("code") && !p.includes("password"))
  );
}

/**
 * Connect with Netcatty-like preference: password before keyboard-interactive.
 * Records offered methods and KI rounds for assertions.
 */
function connectWithNetcattyOrder(opts) {
  // Lazy require so mock tests can patch first if needed
  const { Client } = require("ssh2");
  const {
    host,
    port = 22,
    username,
    password,
    totpSecret,
    secondaryPassword,
    readyTimeout = 15000,
  } = opts;

  const offered = [];
  const kiRounds = [];
  let passwordMethodTried = false;

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const done = (err, result) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(result);
    };

    conn.on("ready", () => {
      done(null, {
        offered,
        kiRounds,
        passwordMethodTried,
        ok: true,
      });
    });
    conn.on("error", (err) => done(err));

    const order = ["none", "password", "keyboard-interactive"];
    let attempted = new Set();
    let succeeded = new Set();
    let failed = new Set();
    let lastOffered = null;
    let hadPartial = false;

    conn.connect({
      host,
      port,
      username,
      password,
      tryKeyboard: true,
      readyTimeout,
      authHandler: (methodsLeft, partialSuccess, callback) => {
        if (partialSuccess) {
          hadPartial = true;
          if (lastOffered) succeeded.add(lastOffered);
          attempted = new Set([...failed, ...succeeded]);
          if (Array.isArray(methodsLeft) && methodsLeft.includes("keyboard-interactive")) {
            attempted.delete("keyboard-interactive");
          }
        } else if (lastOffered && methodsLeft != null) {
          failed.add(lastOffered);
        }

        const available = Array.isArray(methodsLeft) && methodsLeft.length
          ? methodsLeft
          : null;

        // After partial success prefer KI (matches current Netcatty strategy)
        if (
          hadPartial
          && (!available || available.includes("keyboard-interactive"))
          && !attempted.has("keyboard-interactive")
        ) {
          attempted.add("keyboard-interactive");
          lastOffered = "keyboard-interactive";
          offered.push("keyboard-interactive");
          return callback("keyboard-interactive");
        }

        for (const method of order) {
          if (attempted.has(method)) continue;
          if (available && !available.includes(method) && method !== "none") continue;
          attempted.add(method);
          lastOffered = method;
          offered.push(method);
          if (method === "password") passwordMethodTried = true;
          return callback(method === "none" ? "none" : method);
        }
        return callback(false);
      },
    });

    conn.on("keyboard-interactive", (name, instructions, lang, prompts, finish) => {
      const round = {
        name: name || "",
        instructions: instructions || "",
        prompts: (prompts || []).map((p) => ({
          prompt: p.prompt,
          echo: p.echo,
        })),
      };
      kiRounds.push(round);

      const responses = (prompts || []).map((p) => {
        const text = p.prompt || "";
        if (isSecondaryLikePrompt(text)) {
          if (totpSecret) return totp(totpSecret);
          if (secondaryPassword) return secondaryPassword;
          return "";
        }
        if (isPasswordLikePrompt(text) || /password/i.test(text)) {
          return password || "";
        }
        // Default: TOTP if looks like code, else password
        if (/code/i.test(text) && totpSecret) return totp(totpSecret);
        return password || "";
      });
      finish(responses);
    });
  });
}

// ---------------------------------------------------------------------------
// Mock models (always on) — Model A / B / C / password-only
// ---------------------------------------------------------------------------

function createMockServer(scenario) {
  class MockClient extends EventEmitter {
    constructor() {
      super();
      MockClient.instances.push(this);
      this.authMethodsOffered = [];
      this.kiRounds = [];
      this.passwordMethodTries = 0;
    }

    connect(opts) {
      this.connectOpts = opts;
      setImmediate(() => this._run(opts));
    }

    _run(opts) {
      const offer = (methodsLeft, partialSuccess) => {
        let offered;
        opts.authHandler(methodsLeft, partialSuccess, (method) => {
          offered = method;
          this.authMethodsOffered.push(method && typeof method === "object" ? method.type || method : method);
        });
        return offered;
      };

      this.emit("connect");
      this.emit("handshake");
      offer(null, null); // none

      if (scenario === "password-only") {
        const m = offer(["password", "keyboard-interactive"], false);
        if (m !== "password") {
          return this.emit("error", Object.assign(new Error("expected password first"), { level: "client-authentication" }));
        }
        this.passwordMethodTries += 1;
        this.emit("ready");
        return;
      }

      if (scenario === "A-password-then-ki") {
        // Server advertises both; password partial, then KI secondary
        const m1 = offer(["password", "keyboard-interactive"], false);
        if (m1 !== "password") {
          return this.emit("error", Object.assign(new Error(`expected password, got ${m1}`), { level: "client-authentication" }));
        }
        this.passwordMethodTries += 1;
        const m2 = offer(["password", "keyboard-interactive"], true);
        if (m2 !== "keyboard-interactive") {
          return this.emit("error", Object.assign(new Error(`expected KI after partial, got ${m2}`), { level: "client-authentication" }));
        }
        this.emit(
          "keyboard-interactive",
          "Keyboard-interactive authentication prompts from server",
          "为保障主机安全，请输入二次认证密码",
          "",
          [{ prompt: "Secondary Authentication Password:", echo: false }],
          (responses) => {
            this.kiRounds.push(responses);
            if (responses[0] === "secondary-secret") this.emit("ready");
            else this.emit("error", Object.assign(new Error("bad secondary"), { level: "client-authentication" }));
          },
        );
        return;
      }

      if (scenario === "B-dual-ki") {
        // Server only KI; two rounds
        const m1 = offer(["keyboard-interactive"], false);
        if (m1 !== "keyboard-interactive") {
          return this.emit("error", Object.assign(new Error(`expected KI, got ${m1}`), { level: "client-authentication" }));
        }
        this.emit(
          "keyboard-interactive",
          "",
          "",
          "",
          [{ prompt: "Password:", echo: false }],
          (responses) => {
            this.kiRounds.push(responses);
            const m2 = offer(["keyboard-interactive"], true);
            if (m2 !== "keyboard-interactive") {
              return this.emit("error", Object.assign(new Error(`expected second KI, got ${m2}`), { level: "client-authentication" }));
            }
            this.emit(
              "keyboard-interactive",
              "",
              "",
              "",
              [{ prompt: "Verification code:", echo: false }],
              (responses2) => {
                this.kiRounds.push(responses2);
                this.emit("ready");
              },
            );
          },
        );
        return;
      }

      if (scenario === "C-password-full-skips-mfa") {
        // Pathological: both advertised, password fully succeeds, no KI
        const m1 = offer(["password", "keyboard-interactive"], false);
        if (m1 !== "password") {
          return this.emit("error", Object.assign(new Error(`expected password, got ${m1}`), { level: "client-authentication" }));
        }
        this.passwordMethodTries += 1;
        // Server never sends KI — documents gap for model C
        this.emit("ready");
        return;
      }

      this.emit("error", new Error(`unknown scenario ${scenario}`));
    }

    end() {}
    destroy() {}
  }
  MockClient.instances = [];
  return MockClient;
}

function runMockScenario(scenario, { password = "login-password", secondary = "secondary-secret", totpCode = "123456" } = {}) {
  const MockClient = createMockServer(scenario);
  const originalLoad = Module._load;
  const ssh2PathHints = ["ssh2", path.join("node_modules", "ssh2")];
  Module._load = function patched(request, parent, isMain) {
    if (request === "ssh2" || ssh2PathHints.some((h) => String(request).includes("ssh2") && request.endsWith("ssh2"))) {
      // only replace exact ssh2 package
    }
    if (request === "ssh2") {
      return { Client: MockClient, utils: { parseKey: () => new Error("n/a") } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return new Promise((resolve, reject) => {
    try {
      // inline connect without require cache issues
      const conn = new MockClient();
      const offered = [];
      const kiRounds = [];
      let passwordMethodTried = false;
      let hadPartial = false;
      const order = ["none", "password", "keyboard-interactive"];
      let attempted = new Set();
      let succeeded = new Set();
      let failed = new Set();
      let lastOffered = null;

      conn.on("ready", () => {
        Module._load = originalLoad;
        resolve({
          offered: conn.authMethodsOffered,
          kiRounds: conn.kiRounds,
          passwordMethodTries: conn.passwordMethodTries,
          passwordMethodTried,
          ok: true,
        });
      });
      conn.on("error", (err) => {
        Module._load = originalLoad;
        reject(err);
      });
      conn.on("keyboard-interactive", (name, instructions, lang, prompts, finish) => {
        const responses = (prompts || []).map((p) => {
          const text = p.prompt || "";
          if (isSecondaryLikePrompt(text)) return secondary || totpCode;
          return password;
        });
        finish(responses);
      });

      conn.connect({
        username: "alice",
        password,
        tryKeyboard: true,
        authHandler: (methodsLeft, partialSuccess, callback) => {
          if (partialSuccess) {
            hadPartial = true;
            if (lastOffered) succeeded.add(lastOffered);
            attempted = new Set([...failed, ...succeeded]);
            if (Array.isArray(methodsLeft) && methodsLeft.includes("keyboard-interactive")) {
              attempted.delete("keyboard-interactive");
            }
          } else if (lastOffered && methodsLeft != null) {
            failed.add(lastOffered);
          }
          const available = Array.isArray(methodsLeft) && methodsLeft.length ? methodsLeft : null;
          if (
            hadPartial
            && (!available || available.includes("keyboard-interactive"))
            && !attempted.has("keyboard-interactive")
          ) {
            attempted.add("keyboard-interactive");
            lastOffered = "keyboard-interactive";
            return callback("keyboard-interactive");
          }
          for (const method of order) {
            if (attempted.has(method)) continue;
            if (available && method !== "none" && !available.includes(method)) continue;
            attempted.add(method);
            lastOffered = method;
            if (method === "password") passwordMethodTried = true;
            return callback(method);
          }
          return callback(false);
        },
      });
    } catch (err) {
      Module._load = originalLoad;
      reject(err);
    }
  });
}

test("mock model password-only: tries password method first and succeeds", async () => {
  const result = await runMockScenario("password-only");
  assert.equal(result.passwordMethodTries, 1);
  assert.deepEqual(result.offered, ["none", "password"]);
  assert.equal(result.kiRounds.length, 0);
});

test("mock model A: password first, partial, then KI secondary (EDR-like)", async () => {
  const result = await runMockScenario("A-password-then-ki");
  assert.equal(result.passwordMethodTries, 1);
  assert.deepEqual(result.offered, ["none", "password", "keyboard-interactive"]);
  assert.equal(result.kiRounds.length, 1);
  assert.deepEqual(result.kiRounds[0], ["secondary-secret"]);
});

test("mock model B: dual keyboard-interactive (password then verification code)", async () => {
  const result = await runMockScenario("B-dual-ki", { password: "login-password", secondary: "123456" });
  assert.equal(result.passwordMethodTries, 0);
  assert.ok(result.offered.includes("keyboard-interactive"));
  assert.equal(result.kiRounds.length, 2);
  assert.deepEqual(result.kiRounds[0], ["login-password"]);
  assert.deepEqual(result.kiRounds[1], ["123456"]);
});

test("mock model C: password full success skips KI (documents remaining gap)", async () => {
  const result = await runMockScenario("C-password-full-skips-mfa");
  assert.equal(result.passwordMethodTries, 1);
  assert.deepEqual(result.offered, ["none", "password"]);
  assert.equal(result.kiRounds.length, 0);
  // This is the pathological server behavior: client cannot force MFA if server
  // accepts password as full authentication.
});

// ---------------------------------------------------------------------------
// Live lab host
// ---------------------------------------------------------------------------

const liveEdrpw = LIVE && hasLiveCreds(LAB.edrpw) ? test : test.skip;
const liveEdrtest = LIVE && hasLiveCreds(LAB.edrtest) ? test : test.skip;
const liveEdrmix = LIVE && hasLiveCreds(LAB.edrmix) ? test : test.skip;
const liveEdrsec = LIVE && hasLiveCreds(LAB.edrsec) ? test : test.skip;

liveEdrpw("live edrpw: password method only", async () => {
  const result = await connectWithNetcattyOrder({
    host: LIVE_HOST,
    port: LIVE_PORT,
    username: LAB.edrpw.username,
    password: LAB.edrpw.password,
  });
  assert.equal(result.ok, true);
  assert.equal(result.passwordMethodTried, true);
  assert.ok(result.offered.includes("password"));
  assert.equal(result.kiRounds.length, 0);
});

liveEdrtest("live edrtest: dual KI password + TOTP (model B)", async () => {
  const result = await connectWithNetcattyOrder({
    host: LIVE_HOST,
    port: LIVE_PORT,
    username: LAB.edrtest.username,
    password: LAB.edrtest.password,
    totpSecret: LAB.edrtest.totpSecret,
  });
  assert.equal(result.ok, true);
  assert.equal(result.passwordMethodTried, false, "server only allows KI");
  assert.ok(result.kiRounds.length >= 2, `expected >=2 KI rounds, got ${result.kiRounds.length}`);
  const prompts = result.kiRounds.map((r) => r.prompts.map((p) => p.prompt).join("|")).join(" || ");
  assert.match(prompts, /password/i);
  assert.match(prompts, /code/i);
});

liveEdrmix("live edrmix: dual KI password + TOTP alt secret (model B variant)", async () => {
  const result = await connectWithNetcattyOrder({
    host: LIVE_HOST,
    port: LIVE_PORT,
    username: LAB.edrmix.username,
    password: LAB.edrmix.password,
    totpSecret: LAB.edrmix.totpSecret,
  });
  assert.equal(result.ok, true);
  assert.ok(result.kiRounds.length >= 2);
});

liveEdrsec("live edrsec: dual KI with Secondary Authentication Password prompt", async () => {
  const result = await connectWithNetcattyOrder({
    host: LIVE_HOST,
    port: LIVE_PORT,
    username: LAB.edrsec.username,
    password: LAB.edrsec.password,
    secondaryPassword: LAB.edrsec.secondaryPassword,
  });
  assert.equal(result.ok, true);
  assert.ok(result.kiRounds.length >= 2, `expected >=2 KI rounds, got ${JSON.stringify(result.kiRounds, null, 2)}`);
  const allPrompts = result.kiRounds.flatMap((r) => r.prompts.map((p) => p.prompt)).join("\n");
  assert.match(allPrompts, /Secondary Authentication Password/i);
});
