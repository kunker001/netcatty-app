const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  buildAuthoritativeKnownHostsContent,
  buildExternalHostKeyConfigLines,
  buildExternalHostKeySshOptions,
  buildVaultKnownHostsContent,
  filterKnownHostsContentExcludingVaultHosts,
  formatVaultKnownHostLine,
  getDefaultGlobalKnownHostsPaths,
  quoteOpenSshOptionValue,
  resolveExternalStrictHostKeyChecking,
} = require("./externalSshHostKeyPolicy.cjs");

test("formatVaultKnownHostLine builds OpenSSH known_hosts lines", () => {
  const validBlob = "AAAAC3NzaC1lZDI1NTE5AAAAIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH";
  assert.equal(
    formatVaultKnownHostLine({
      hostname: "host.example",
      port: 22,
      keyType: "ssh-ed25519",
      publicKey: `ssh-ed25519 ${validBlob}`,
    }),
    `host.example ssh-ed25519 ${validBlob}`,
  );
  assert.equal(
    formatVaultKnownHostLine({
      hostname: "host.example",
      port: 2222,
      keyType: "ssh-ed25519",
      publicKey: validBlob,
    }),
    `[host.example]:2222 ssh-ed25519 ${validBlob}`,
  );
});

test("formatVaultKnownHostLine skips fingerprint-only vault entries", () => {
  assert.equal(
    formatVaultKnownHostLine({
      hostname: "host.example",
      keyType: "ssh-ed25519",
      publicKey: "SHA256:abcdef",
      fingerprint: "abcdef",
    }),
    null,
  );
  // Unprefixed fingerprint-like token must not be treated as a key blob.
  assert.equal(
    formatVaultKnownHostLine({
      hostname: "host.example",
      keyType: "ssh-ed25519",
      publicKey: "not-a-real-key-blob",
    }),
    null,
  );
});

test("buildVaultKnownHostsContent joins usable vault entries", () => {
  const content = buildVaultKnownHostsContent([
    {
      hostname: "a.example",
      keyType: "ssh-ed25519",
      publicKey: "ssh-ed25519 AAAAa",
    },
    { hostname: "skip.example", fingerprint: "only" },
    {
      hostname: "b.example",
      port: 2200,
      keyType: "ssh-rsa",
      publicKey: "ssh-rsa AAAAb",
    },
  ]);
  assert.equal(
    content,
    "a.example ssh-ed25519 AAAAa\n[b.example]:2200 ssh-rsa AAAAb\n",
  );
});

test("getDefaultGlobalKnownHostsPaths covers Unix and Windows defaults", () => {
  assert.deepEqual(getDefaultGlobalKnownHostsPaths({ platform: "linux" }), [
    "/etc/ssh/ssh_known_hosts",
    "/etc/ssh/ssh_known_hosts2",
  ]);
  assert.deepEqual(
    getDefaultGlobalKnownHostsPaths({ platform: "win32", programData: "C:\\ProgramData" }),
    [
      path.join("C:\\ProgramData", "ssh", "ssh_known_hosts"),
      path.join("C:\\ProgramData", "ssh", "ssh_known_hosts2"),
    ],
  );
});

test("filterKnownHostsContentExcludingVaultHosts drops conflicting system pins", () => {
  const content = [
    "host.example ssh-ed25519 AAASYSTEM",
    "other.example ssh-rsa AAAOTHER",
    "[host.example]:2222 ssh-ed25519 AAAPORT",
    "# comment kept",
  ].join("\n");
  const filtered = filterKnownHostsContentExcludingVaultHosts(content, [
    { hostname: "host.example", port: 22 },
  ]);
  assert.doesNotMatch(filtered, /AAASYSTEM/);
  assert.match(filtered, /other\.example ssh-rsa AAAOTHER/);
  assert.match(filtered, /\[host\.example\]:2222/);
  assert.match(filtered, /# comment kept/);
});

test("filterKnownHostsContentExcludingVaultHosts rewrites multi-host lines", () => {
  const content = "jump.example,target.example ssh-ed25519 AAASHARED\n";
  const filtered = filterKnownHostsContentExcludingVaultHosts(content, [
    { hostname: "jump.example", port: 22 },
  ]);
  // Jump pattern removed; target pattern kept so unpinned target stays trusted.
  assert.match(filtered, /^target\.example ssh-ed25519 AAASHARED$/m);
  assert.doesNotMatch(filtered, /jump\.example/);
});

test("filterKnownHostsContentExcludingVaultHosts drops wildcards covering vault hosts", () => {
  const {
    filterKnownHostsContentExcludingVaultHosts: filter,
  } = require("./externalSshHostKeyPolicy.cjs");
  const content = [
    "*.example.com ssh-ed25519 AAAWILD",
    "db.example.com ssh-rsa AAADB",
    "unrelated.example.org ssh-ed25519 AAAOK",
  ].join("\n");
  const filtered = filter(content, [{ hostname: "host.example.com", port: 22 }]);
  assert.doesNotMatch(filtered, /AAAWILD/);
  assert.match(filtered, /db\.example\.com/);
  assert.match(filtered, /AAAOK/);
});

test("filterKnownHostsContentExcludingVaultHosts respects negated patterns", () => {
  const {
    filterKnownHostsContentExcludingVaultHosts: filter,
  } = require("./externalSshHostKeyPolicy.cjs");
  // OpenSSH: target.example.com is excluded by !target; jump still matches.
  const content = "*.example.com,!target.example.com ssh-ed25519 AAAJUMP\n";
  const filteredForTarget = filter(content, [{ hostname: "target.example.com", port: 22 }]);
  // Negation means this line does not pin target → keep it for the jump host.
  assert.match(filteredForTarget, /AAAJUMP/);
  const filteredForJump = filter(content, [{ hostname: "jump.example.com", port: 22 }]);
  // Jump matches the positive wildcard → drop so vault remains authoritative.
  assert.doesNotMatch(filteredForJump, /AAAJUMP/);
});

test("filterKnownHostsContentExcludingVaultHosts keeps @revoked for vault hosts", () => {
  const {
    filterKnownHostsContentExcludingVaultHosts: filter,
  } = require("./externalSshHostKeyPolicy.cjs");
  const content = [
    "@revoked host.example ssh-ed25519 AAAREVOKED",
    "host.example ssh-ed25519 AAASYSTEM",
    "other.example ssh-rsa AAAOTHER",
  ].join("\n");
  const filtered = filter(content, [{ hostname: "host.example", port: 22 }]);
  assert.match(filtered, /@revoked host\.example ssh-ed25519 AAAREVOKED/);
  assert.doesNotMatch(filtered, /AAASYSTEM/);
  assert.match(filtered, /other\.example/);
});

test("vaultPinsConnectionHosts only matches the active connection", () => {
  const { vaultPinsConnectionHosts } = require("./externalSshHostKeyPolicy.cjs");
  const knownHosts = [{
    hostname: "other.example",
    keyType: "ssh-ed25519",
    publicKey: "ssh-ed25519 AAAA",
  }];
  assert.equal(
    vaultPinsConnectionHosts(knownHosts, [{ hostname: "target.example", port: 22 }]),
    false,
  );
  assert.equal(
    vaultPinsConnectionHosts(knownHosts, [{ hostname: "other.example", port: 22 }]),
    true,
  );
});

test("filterKnownHostsContentExcludingVaultHosts matches hashed host entries", () => {
  const hostname = "hashed.example";
  const salt = crypto.randomBytes(20);
  const digest = crypto.createHmac("sha1", salt).update(hostname).digest("base64");
  const hostField = `|1|${salt.toString("base64")}|${digest}`;
  const content = `${hostField} ssh-ed25519 AAAHASHED\nother.example ssh-rsa AAAOTHER\n`;
  const filtered = filterKnownHostsContentExcludingVaultHosts(content, [
    { hostname, port: 22 },
  ]);
  assert.doesNotMatch(filtered, /AAAHASHED/);
  assert.match(filtered, /other\.example/);
});

test("buildAuthoritativeKnownHostsContent makes vault authoritative over system pins", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-kh-auth-"));
  try {
    const global1 = path.join(base, "ssh_known_hosts");
    const user1 = path.join(base, "user_known_hosts");
    fs.writeFileSync(global1, "host.example ssh-ed25519 AAAGLOBAL\nadmin.example ssh-rsa AAAADMIN\n");
    fs.writeFileSync(user1, "host.example ssh-ed25519 AAAUSER\nother.example ssh-ed25519 AAAOTHER\n");

    const content = buildAuthoritativeKnownHostsContent({
      knownHosts: [{
        hostname: "host.example",
        keyType: "ssh-ed25519",
        publicKey: "ssh-ed25519 AAAVAULT",
      }],
      fs,
      globalPaths: [global1],
      userPaths: [user1],
    });

    assert.match(content, /host\.example ssh-ed25519 AAAVAULT/);
    assert.doesNotMatch(content, /AAAGLOBAL/);
    assert.doesNotMatch(content, /AAAUSER/);
    assert.match(content, /admin\.example ssh-rsa AAAADMIN/);
    assert.match(content, /other\.example ssh-ed25519 AAAOTHER/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("buildAuthoritativeKnownHostsContent merges ssh -G global known_hosts paths", () => {
  const {
    buildAuthoritativeKnownHostsContent: build,
  } = require("./externalSshHostKeyPolicy.cjs");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-kh-sshg-"));
  try {
    const customGlobal = path.join(base, "custom_global_known_hosts");
    fs.writeFileSync(customGlobal, "admin.custom ssh-ed25519 AAAADMINCUSTOM\n");
    const content = build({
      knownHosts: [{
        hostname: "host.example",
        keyType: "ssh-ed25519",
        publicKey: "ssh-ed25519 AAAVAULT",
      }],
      fs,
      hostname: "host.example",
      // Force discovery path (no explicit globalPaths).
      globalPaths: undefined,
      userPaths: [],
      execFileSyncFn: () => `globalknownhostsfile ${customGlobal}\n`,
    });
    assert.match(content, /host\.example ssh-ed25519 AAAVAULT/);
    assert.match(content, /admin\.custom ssh-ed25519 AAAADMINCUSTOM/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("buildAuthoritativeKnownHostsContent honors HostKeyAlias for vault pins", () => {
  const {
    buildAuthoritativeKnownHostsContent: build,
  } = require("./externalSshHostKeyPolicy.cjs");
  const content = build({
    knownHosts: [{
      hostname: "host.example",
      keyType: "ssh-ed25519",
      publicKey: "ssh-ed25519 AAAVAULT",
    }],
    fs,
    hostname: "host.example",
    port: 22,
    globalPaths: [],
    userPaths: [],
    execFileSyncFn: () => "hostkeyalias shared-key\nhostname host.example\n",
  });
  assert.match(content, /^shared-key ssh-ed25519 AAAVAULT$/m);
  assert.doesNotMatch(content, /^host\.example ssh-ed25519 AAAVAULT$/m);
});

test("buildAuthoritativeKnownHostsContent rewrites pins under resolved HostName", () => {
  const {
    buildAuthoritativeKnownHostsContent: build,
  } = require("./externalSshHostKeyPolicy.cjs");
  const content = build({
    knownHosts: [{
      hostname: "prod",
      keyType: "ssh-ed25519",
      publicKey: "ssh-ed25519 AAAVAULT",
    }],
    fs,
    hostname: "prod",
    port: 22,
    globalPaths: [],
    userPaths: [],
    execFileSyncFn: () => "hostname 10.0.0.5\n",
  });
  assert.match(content, /^10\.0\.0\.5 ssh-ed25519 AAAVAULT$/m);
  assert.doesNotMatch(content, /^prod ssh-ed25519 AAAVAULT$/m);
});

test("buildAuthoritativeKnownHostsContent keeps port form for resolved HostName", () => {
  const {
    buildAuthoritativeKnownHostsContent: build,
  } = require("./externalSshHostKeyPolicy.cjs");
  const content = build({
    knownHosts: [{
      hostname: "prod",
      port: 2222,
      keyType: "ssh-ed25519",
      publicKey: "ssh-ed25519 AAAVAULT",
    }],
    fs,
    hostname: "prod",
    port: 2222,
    globalPaths: [],
    userPaths: [],
    execFileSyncFn: () => "hostname 10.0.0.5\n",
  });
  assert.match(content, /^\[10\.0\.0\.5\]:2222 ssh-ed25519 AAAVAULT$/m);
  assert.doesNotMatch(content, /^10\.0\.0\.5 ssh-ed25519 AAAVAULT$/m);
});

test("runSshG discovery receives port and username", () => {
  const { buildAuthoritativeKnownHostsContent: build } = require("./externalSshHostKeyPolicy.cjs");
  let capturedArgs = null;
  build({
    knownHosts: [{
      hostname: "host.example",
      port: 2222,
      keyType: "ssh-ed25519",
      publicKey: "ssh-ed25519 AAAVAULT",
    }],
    fs,
    hostname: "host.example",
    port: 2222,
    username: "bob",
    globalPaths: [],
    userPaths: [],
    execFileSyncFn: (_cmd, args) => {
      capturedArgs = args;
      return "hostkeyalias none\n";
    },
  });
  assert.deepEqual(capturedArgs, ["-G", "-p", "2222", "-l", "bob", "host.example"]);
});

test("parseSshGKnownHostsPaths reads multi-path directives", () => {
  const { parseSshGKnownHostsPaths } = require("./externalSshHostKeyPolicy.cjs");
  assert.deepEqual(
    parseSshGKnownHostsPaths(
      "globalknownhostsfile /etc/ssh/ssh_known_hosts /etc/custom/known_hosts\nuserknownhostsfile ~/.ssh/known_hosts\n",
      "globalknownhostsfile",
      { homedir: "/home/me", pathModule: path },
    ),
    ["/etc/ssh/ssh_known_hosts", "/etc/custom/known_hosts"],
  );
  assert.deepEqual(
    parseSshGKnownHostsPaths(
      "userknownhostsfile ~/.ssh/known_hosts ~/.ssh/known_hosts2\n",
      "userknownhostsfile",
      { homedir: "/home/me", pathModule: path },
    ),
    [
      path.join("/home/me", ".ssh", "known_hosts"),
      path.join("/home/me", ".ssh", "known_hosts2"),
    ],
  );
});

test("parseSshGKnownHostsPaths preserves paths that contain spaces", () => {
  const { parseSshGKnownHostsPaths } = require("./externalSshHostKeyPolicy.cjs");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-kh-space-"));
  try {
    const spaced = path.join(base, "dir with space", "global kh");
    fs.mkdirSync(path.dirname(spaced), { recursive: true });
    fs.writeFileSync(spaced, "ok\n");
    assert.deepEqual(
      parseSshGKnownHostsPaths(
        `globalknownhostsfile ${spaced}\n`,
        "globalknownhostsfile",
        { fs, pathModule: path },
      ),
      [spaced],
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("buildAuthoritativeKnownHostsContent merges effective user known_hosts paths", () => {
  const {
    buildAuthoritativeKnownHostsContent: build,
  } = require("./externalSshHostKeyPolicy.cjs");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-kh-user-"));
  try {
    const customUser = path.join(base, "custom_user_known_hosts");
    fs.writeFileSync(customUser, "admin.user ssh-ed25519 AAAUSERCUSTOM\n");
    const content = build({
      knownHosts: [{
        hostname: "host.example",
        keyType: "ssh-ed25519",
        publicKey: "ssh-ed25519 AAAVAULT",
      }],
      fs,
      hostname: "host.example",
      globalPaths: [],
      userPaths: undefined,
      execFileSyncFn: () => `userknownhostsfile ${customUser}\n`,
    });
    assert.match(content, /host\.example ssh-ed25519 AAAVAULT/);
    assert.match(content, /admin\.user ssh-ed25519 AAAUSERCUSTOM/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("buildAuthoritativeKnownHostsContent is empty when vault has no usable pins", () => {
  assert.equal(
    buildAuthoritativeKnownHostsContent({
      knownHosts: [{ hostname: "x", fingerprint: "only" }],
      fs,
      globalPaths: [],
      userPaths: [],
    }),
    "",
  );
});

test("resolveExternalStrictHostKeyChecking matches protocol constraints", () => {
  assert.equal(resolveExternalStrictHostKeyChecking({ protocol: "et" }), "accept-new");
  assert.equal(resolveExternalStrictHostKeyChecking({ protocol: "mosh" }), "ask");
  assert.equal(
    resolveExternalStrictHostKeyChecking({ protocol: "et", verifyHostKeys: false }),
    "no",
  );
  assert.equal(
    resolveExternalStrictHostKeyChecking({ protocol: "mosh", verifyHostKeys: false }),
    "no",
  );
});

test("quoteOpenSshOptionValue quotes paths with whitespace", () => {
  assert.equal(quoteOpenSshOptionValue("/tmp/plain"), "/tmp/plain");
  assert.equal(
    quoteOpenSshOptionValue("/Users/Foo Bar/known_hosts"),
    '"/Users/Foo Bar/known_hosts"',
  );
});

test("buildExternalHostKeySshOptions uses authoritative trust for both slots", () => {
  const values = buildExternalHostKeySshOptions({
    authoritativeKnownHostsPath: "/tmp/auth-kh",
    protocol: "et",
    style: "values",
  });
  assert.deepEqual(values, [
    "UserKnownHostsFile=/tmp/auth-kh",
    "GlobalKnownHostsFile=/tmp/auth-kh",
    "KnownHostsCommand=none",
    "StrictHostKeyChecking=accept-new",
  ]);

  const moshArgs = buildExternalHostKeySshOptions({
    authoritativeKnownHostsPath: "/tmp/auth-kh",
    protocol: "mosh",
    style: "args",
  });
  assert.deepEqual(moshArgs, [
    "-o", "UserKnownHostsFile=/tmp/auth-kh",
    "-o", "GlobalKnownHostsFile=/tmp/auth-kh",
    "-o", "KnownHostsCommand=none",
    "-o", "StrictHostKeyChecking=ask",
  ]);
});

test("buildExternalHostKeySshOptions quotes whitespace paths", () => {
  const values = buildExternalHostKeySshOptions({
    authoritativeKnownHostsPath: "/tmp/user name/auth-kh",
    protocol: "et",
    style: "values",
  });
  assert.deepEqual(values, [
    'UserKnownHostsFile="/tmp/user name/auth-kh"',
    'GlobalKnownHostsFile="/tmp/user name/auth-kh"',
    "KnownHostsCommand=none",
    "StrictHostKeyChecking=accept-new",
  ]);
});

test("buildExternalHostKeySshOptions neutralizes trust when verification is disabled", () => {
  const disabled = buildExternalHostKeySshOptions({
    authoritativeKnownHostsPath: "/tmp/auth-kh",
    emptyKnownHostsPath: "/tmp/empty-kh",
    verifyHostKeys: false,
    protocol: "mosh",
    style: "args",
  });
  assert.deepEqual(disabled, [
    "-o", "UserKnownHostsFile=/tmp/empty-kh",
    "-o", "GlobalKnownHostsFile=/tmp/empty-kh",
    "-o", "KnownHostsCommand=none",
    "-o", "StrictHostKeyChecking=no",
  ]);
  assert.equal(disabled.some((part) => String(part).includes("/tmp/auth-kh")), false);
});

test("buildExternalHostKeyConfigLines formats indented jump-host stanzas", () => {
  const lines = buildExternalHostKeyConfigLines({
    authoritativeKnownHostsPath: "/tmp/auth-kh",
    protocol: "et",
  });
  assert.deepEqual(lines, [
    "  UserKnownHostsFile /tmp/auth-kh",
    "  GlobalKnownHostsFile /tmp/auth-kh",
    "  KnownHostsCommand none",
    "  StrictHostKeyChecking accept-new",
  ]);
});
