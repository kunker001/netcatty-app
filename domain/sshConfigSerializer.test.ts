import test from "node:test";
import assert from "node:assert/strict";

import type { Host } from "./models.ts";
import { serializeHostsToSshConfig } from "./sshConfigSerializer.ts";
import { importVaultHostsFromText } from "./vaultImport.ts";

const makeHost = (overrides: Partial<Host> = {}): Host => ({
  id: "host-1",
  label: "X11 Host",
  hostname: "x11.example.com",
  username: "root",
  port: 22,
  protocol: "ssh",
  os: "linux",
  tags: [],
  ...overrides,
});

test("serializeHostsToSshConfig writes ForwardX11 for hosts with X11 forwarding enabled", () => {
  const config = serializeHostsToSshConfig([makeHost({ x11Forwarding: true })]);

  assert.match(config, /ForwardX11 yes/);
});

test("serializeHostsToSshConfig omits ForwardX11 when X11 forwarding is disabled", () => {
  const config = serializeHostsToSshConfig([makeHost({ x11Forwarding: false })]);

  assert.doesNotMatch(config, /ForwardX11/);
});

test("serializeHostsToSshConfig omits ForwardX11 for mosh hosts", () => {
  const config = serializeHostsToSshConfig([makeHost({ moshEnabled: true, x11Forwarding: true })]);

  assert.doesNotMatch(config, /ForwardX11/);
});

test("serializeHostsToSshConfig preserves system agent authentication directives", () => {
  const config = serializeHostsToSshConfig([makeHost({
    identityFilePaths: ["~/.ssh/aws_root"],
    useSshAgent: true,
    identityAgent: "$SSH_AUTH_SOCK",
    identitiesOnly: true,
    addKeysToAgent: "yes",
    useKeychain: true,
  })]);

  assert.match(config, /IdentityFile ~\/\.ssh\/aws_root/);
  assert.match(config, /IdentityAgent \$SSH_AUTH_SOCK/);
  assert.match(config, /IdentitiesOnly yes/);
  assert.match(config, /AddKeysToAgent yes/);
  assert.match(config, /UseKeychain yes/);
});

test("serializeHostsToSshConfig preserves a disabled imported agent setting", () => {
  const config = serializeHostsToSshConfig([makeHost({
    identityFilePaths: ["~/.ssh/aws_root"],
    useSshAgent: false,
    addKeysToAgent: "yes",
    useKeychain: true,
  })]);
  const imported = importVaultHostsFromText("ssh_config", config);

  assert.match(config, /IdentityAgent none/);
  assert.notEqual(imported.hosts[0]?.useSshAgent, true);
});

test("serializeHostsToSshConfig preserves a plain explicit agent opt-out", () => {
  const config = serializeHostsToSshConfig([makeHost({ useSshAgent: false })]);
  const imported = importVaultHostsFromText("ssh_config", config);

  assert.match(config, /IdentityAgent none/);
  assert.equal(imported.hosts[0]?.useSshAgent, false);
});

test("serializeHostsToSshConfig preserves an enabled default agent setting", () => {
  const config = serializeHostsToSshConfig([makeHost({ useSshAgent: true })]);
  const imported = importVaultHostsFromText("ssh_config", config);

  assert.match(config, /IdentityAgent \$\{SSH_AUTH_SOCK\}/);
  assert.equal(imported.hosts[0]?.useSshAgent, true);
});

test("serializeHostsToSshConfig rejects line injection in serialized fields", () => {
  const maliciousValues: Partial<Host>[] = [
    { username: "root\nProxyCommand /tmp/run" },
    { identityFilePaths: ["~/.ssh/id\rProxyCommand /tmp/run"] },
    { hostname: "host.example.com\0ProxyCommand /tmp/run" },
  ];

  for (const overrides of maliciousValues) {
    assert.throws(
      () => serializeHostsToSshConfig([makeHost(overrides)]),
      /line breaks or null bytes/i,
    );
  }
});

test("serializeHostsToSshConfig encodes Host pattern characters as literal aliases", () => {
  const encoded = serializeHostsToSshConfig([makeHost({ label: "prod*" })]);
  const literal = serializeHostsToSshConfig([makeHost({ label: "prod-2a-" })]);
  const leadingDash = serializeHostsToSshConfig([makeHost({ label: "-jump" })]);
  const quoted = serializeHostsToSshConfig([makeHost({ label: 'bad"alias' })]);
  const escaped = serializeHostsToSshConfig([makeHost({ label: 'bad\\alias' })]);

  assert.match(encoded, /^Host netcatty-encoded-/m);
  assert.match(literal, /^Host prod-2a-$/m);
  assert.notEqual(encoded.match(/^Host (.+)$/m)?.[1], literal.match(/^Host (.+)$/m)?.[1]);
  assert.match(leadingDash, /^Host netcatty-encoded-/m);
  assert.doesNotMatch(leadingDash, /^Host -/m);
  assert.match(quoted, /^Host netcatty-encoded-/m);
  assert.doesNotMatch(quoted, /^Host .*"/m);
  assert.match(escaped, /^Host netcatty-encoded-/m);
  assert.doesNotMatch(escaped, /^Host .*\\/m);
});

test("serializeHostsToSshConfig quotes usernames containing spaces", () => {
  const config = serializeHostsToSshConfig([makeHost({ username: "alice smith" })]);

  assert.match(config, /^ {4}User "alice smith"$/m);
});

test("serializeHostsToSshConfig escapes quoted SSH arguments", () => {
  const config = serializeHostsToSshConfig([makeHost({
    hostname: 'bad"host',
    username: 'alice"ops',
    identityFilePaths: ['~/.ssh/id"quoted', '~/.ssh/id\\backslash'],
    identityAgent: '/tmp/agent"socket',
  })]);

  assert.match(config, /^ {4}HostName "bad\\"host"$/m);
  assert.match(config, /^ {4}User "alice\\"ops"$/m);
  assert.match(config, /^ {4}IdentityFile "~\/\.ssh\/id\\"quoted"$/m);
  assert.match(config, /^ {4}IdentityFile "~\/\.ssh\/id\\\\backslash"$/m);
  assert.match(config, /^ {4}IdentityAgent "\/tmp\/agent\\"socket"$/m);
});

test("serializeHostsToSshConfig rejects ProxyJump separator injection", () => {
  const target = makeHost({
    id: "target",
    hostChain: { hostIds: ["jump"] },
  });
  const jump = makeHost({
    id: "jump",
    hostname: "legit.example,attacker.example",
  });
  const badUsernameJump = makeHost({
    id: "jump",
    hostname: "jump.example.com",
    username: "root,attacker",
  });
  const emailUsernameJump = makeHost({
    id: "jump",
    hostname: "jump.example.com",
    username: "alice@example.com",
  });
  const optionLikeJump = makeHost({
    id: "jump",
    hostname: "-oProxyCommand=run",
    username: "",
  });

  assert.throws(
    () => serializeHostsToSshConfig([target], [target, jump]),
    /ProxyJump separator/i,
  );
  assert.throws(
    () => serializeHostsToSshConfig([target], [target, badUsernameJump]),
    /ProxyJump separator/i,
  );
  assert.match(
    serializeHostsToSshConfig([target], [target, emailUsernameJump]),
    /ProxyJump alice@example\.com@jump\.example\.com/,
  );
  assert.throws(
    () => serializeHostsToSshConfig([target], [target, optionLikeJump]),
    /ProxyJump separator/i,
  );
});
