"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseSsOutput,
  parseNetstatOutput,
  parseLsofOutput,
  parseListeningPorts,
} = require("./portOps.cjs");

test("parseSsOutput reads tcp/udp listeners and process fields", () => {
  const sample = `
Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
tcp   LISTEN 0      128          0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=1234,fd=3))
tcp   LISTEN 0      511                *:80               *:*    users:(("nginx",pid=99,fd=6))
udp   UNCONN 0      0            127.0.0.1:53         0.0.0.0:*    users:(("systemd-resolve",pid=500,fd=12))
tcp6  LISTEN 0      128             [::]:443            [::]:*    users:(("nginx",pid=99,fd=7))
`;
  const ports = parseSsOutput(sample);
  assert.equal(ports.length, 4);
  assert.deepEqual(
    ports.find((p) => p.port === 22),
    {
      id: "tcp|*|22|1234",
      protocol: "tcp",
      address: "*",
      port: 22,
      pid: 1234,
      processName: "sshd",
    },
  );
  assert.equal(ports.find((p) => p.port === 80)?.processName, "nginx");
  assert.equal(ports.find((p) => p.port === 53)?.protocol, "udp");
  assert.equal(ports.find((p) => p.port === 443)?.protocol, "tcp6");
});

test("parseNetstatOutput maps pid/program and keeps BusyBox UDP without PID", () => {
  const sample = `
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      1234/sshd
tcp6       0      0 :::80                   :::*                    LISTEN      99/nginx
udp        0      0 127.0.0.1:53            0.0.0.0:*
udp        0      0 0.0.0.0:5353            0.0.0.0:*               456/dnsmasq
`;
  const ports = parseNetstatOutput(sample);
  assert.equal(ports.length, 4);
  assert.equal(ports.find((p) => p.port === 22)?.processName, "sshd");
  assert.equal(ports.find((p) => p.port === 80)?.address, "*");
  assert.equal(ports.find((p) => p.port === 53)?.protocol, "udp");
  assert.equal(ports.find((p) => p.port === 53)?.pid, null);
  assert.equal(ports.find((p) => p.port === 5353)?.pid, 456);
  assert.equal(ports.find((p) => p.port === 5353)?.processName, "dnsmasq");
});

test("parseNetstatOutput keeps spaced UDP program names without State", () => {
  const sample = `
udp        0      0 0.0.0.0:5353            0.0.0.0:*               882/avahi-daemon: r
udp        0      0 0.0.0.0:53              0.0.0.0:*               100/named -u bind
`;
  const ports = parseNetstatOutput(sample);
  assert.equal(ports.find((p) => p.port === 5353)?.pid, 882);
  assert.equal(ports.find((p) => p.port === 5353)?.processName, "avahi-daemon: r");
  assert.equal(ports.find((p) => p.port === 53)?.pid, 100);
  assert.equal(ports.find((p) => p.port === 53)?.processName, "named -u bind");
});

test("parseNetstatOutput understands macOS dotted addresses", () => {
  const sample = `
Active Internet connections
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)
tcp4       0      0  *.22                   *.*                    LISTEN
tcp4       0      0  127.0.0.1.631          *.*                    LISTEN
`;
  const ports = parseNetstatOutput(sample);
  assert.equal(ports.length, 2);
  assert.equal(ports.find((p) => p.port === 22)?.address, "*");
  assert.equal(ports.find((p) => p.port === 631)?.address, "127.0.0.1");
});

test("parseListeningPorts merges ss/netstat/lsof and prefers process-aware rows", () => {
  const stdout = `
__NC_PORTS_BEGIN__
__NC_NETSTAT__
tcp4       0      0  *.22                   *.*                    LISTEN
__NC_LSOF__
sshd    1234 root  3u  IPv4 0x1      0t0  TCP *:22 (LISTEN)
__NC_PORTS_END__
`;
  const ports = parseListeningPorts(stdout);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].port, 22);
  assert.equal(ports[0].pid, 1234);
  assert.equal(ports[0].processName, "sshd");
});

test("parseLsofOutput reads TCP LISTEN rows", () => {
  const sample = `
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
nginx      99 root    6u  IPv4 0xabc      0t0  TCP *:80 (LISTEN)
`;
  const ports = parseLsofOutput(sample);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].port, 80);
  assert.equal(ports[0].processName, "nginx");
});

test("parseNetstatOutput rejects established TCP and connected UDP", () => {
  const sample = `
tcp        0      0 10.0.0.1:22            10.0.0.2:40000         ESTABLISHED 1234/sshd
tcp        0      0 10.0.0.1:22            10.0.0.2:40000         1234/sshd
udp        0      0 10.0.0.5:68            10.0.0.1:67
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      9/sshd
`;
  const ports = parseNetstatOutput(sample);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].port, 22);
  assert.equal(ports[0].processName, "sshd");
});

test("parseLsofOutput ignores connected UDP and non-listen TCP", () => {
  const sample = `
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
chrome   1000 user   10u  IPv4 0x1      0t0  UDP 10.0.0.1:53122->8.8.8.8:53
nginx      99 root    6u  IPv4 0xabc      0t0  TCP 10.0.0.1:80->10.0.0.2:12345 (ESTABLISHED)
sshd     1234 root    3u  IPv4 0x2      0t0  TCP *:22 (LISTEN)
`;
  const ports = parseLsofOutput(sample);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].port, 22);
});

test("parseLsofOutput keeps bracketed IPv6 listeners as tcp6", () => {
  const sample = `
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
nginx      99 root    7u  IPv6 0xabc      0t0  TCP [::1]:80 (LISTEN)
`;
  const ports = parseLsofOutput(sample);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].protocol, "tcp6");
  assert.equal(ports[0].address, "::1");
  assert.equal(ports[0].port, 80);
});

test("parseNetstatOutput keeps macOS IPv6 dotted ports", () => {
  const sample = `
tcp6       0      0  ::1.631                *.*                    LISTEN
tcp6       0      0  fe80::1%lo0.22         *.*                    LISTEN
`;
  const ports = parseNetstatOutput(sample);
  assert.equal(ports.length, 2);
  assert.equal(ports.find((p) => p.port === 631)?.address, "::1");
  assert.equal(ports.find((p) => p.port === 22)?.address, "fe80::1");
});

test("parseSsOutput rejects UDP with non-wildcard peers", () => {
  const sample = `
udp   UNCONN 0      0            10.0.0.5:68         10.0.0.1:67    users:(("dhclient",pid=7,fd=1))
udp   UNCONN 0      0            0.0.0.0:5353            0.0.0.0:*    users:(("avahi",pid=8,fd=1))
`;
  const ports = parseSsOutput(sample);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].port, 5353);
});

test("parseListeningPorts merges ss tcp6 with lsof IPv6 without duplicating", () => {
  const stdout = `
__NC_PORTS_BEGIN__
__NC_SS__
tcp6  LISTEN 0      128             [::]:80             [::]:*    users:(("nginx",pid=99,fd=7))
__NC_LSOF__
nginx      99 root    7u  IPv6 0xabc      0t0  TCP *:80 (LISTEN)
__NC_PORTS_END__
`;
  const ports = parseListeningPorts(stdout);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].protocol, "tcp6");
  assert.equal(ports[0].pid, 99);
});

test("parseListeningPorts keeps SO_REUSEPORT listeners as separate pid rows", () => {
  const sample = `
tcp   LISTEN 0      128          0.0.0.0:8080         0.0.0.0:*    users:(("app",pid=11,fd=3))
tcp   LISTEN 0      128          0.0.0.0:8080         0.0.0.0:*    users:(("app",pid=12,fd=3))
`;
  const ports = parseSsOutput(sample);
  assert.equal(ports.length, 2);
  assert.deepEqual(ports.map((p) => p.pid).sort((a, b) => a - b), [11, 12]);
});

test("parseListeningPorts reads Windows UDP endpoints from Protocol field", () => {
  const stdout = `
__NC_PORTS_BEGIN__
__NC_WIN__
[{"LocalAddress":"0.0.0.0","LocalPort":53,"OwningProcess":500,"Protocol":"udp"},{"LocalAddress":"::","LocalPort":22,"OwningProcess":1234,"Protocol":"tcp"}]
__NC_PORTS_END__
`;
  const ports = parseListeningPorts(stdout);
  assert.equal(ports.length, 2);
  assert.equal(ports.find((p) => p.port === 53)?.protocol, "udp");
  assert.equal(ports.find((p) => p.port === 22)?.protocol, "tcp6");
});

test("parseLsofOutput keeps Idle UDP listeners", () => {
  const sample = `
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
mdnsd     200 root   12u  IPv4 0x1      0t0  UDP *:5353
`;
  const ports = parseLsofOutput(sample);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].protocol, "udp");
  assert.equal(ports[0].port, 5353);
});

test("parseNetstatOutput accepts macOS tcp46/udp46 dual-stack rows", () => {
  const sample = `
tcp46      0      0  *.80                   *.*                    LISTEN
udp46      0      0  *.5353                 *.*
`;
  const ports = parseNetstatOutput(sample);
  assert.equal(ports.length, 2);
  assert.equal(ports.find((p) => p.port === 80)?.protocol, "tcp6");
  assert.equal(ports.find((p) => p.port === 5353)?.protocol, "udp6");
});

test("parseListeningPorts merges macOS tcp46 netstat with lsof IPv6", () => {
  const stdout = `
__NC_PORTS_BEGIN__
__NC_NETSTAT__
tcp46      0      0  *.80                   *.*                    LISTEN
__NC_LSOF__
nginx      99 root    7u  IPv6 0xabc      0t0  TCP *:80 (LISTEN)
__NC_PORTS_END__
`;
  const ports = parseListeningPorts(stdout);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].protocol, "tcp6");
  assert.equal(ports[0].pid, 99);
});

test("parseSsOutput expands multi-pid users tuples", () => {
  const sample = `
tcp   LISTEN 0      128          0.0.0.0:8080         0.0.0.0:*    users:(("app",pid=11,fd=3),("app",pid=12,fd=4))
`;
  const ports = parseSsOutput(sample);
  assert.equal(ports.length, 2);
  assert.deepEqual(ports.map((p) => p.pid).sort((a, b) => a - b), [11, 12]);
});
