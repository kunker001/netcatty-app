const test = require("node:test");
const assert = require("node:assert/strict");

const Protocol = require("ssh2/lib/protocol/Protocol");

function parseIdentification(line) {
  let header;
  const protocol = new Protocol({
    onWrite() {},
    onError(err) {
      throw err;
    },
    onHeader(nextHeader) {
      header = nextHeader;
    },
  });

  const data = Buffer.from(`${line}\r\n`, "latin1");
  protocol.parse(data, 0, data.length);

  assert.ok(header, "expected SSH header to be parsed");
  return header;
}

test("ssh2 accepts an empty softwareversion for compatibility", () => {
  const header = parseIdentification("SSH-2.0-");

  assert.equal(header.versions.protocol, "2.0");
  assert.equal(header.versions.software, "");
  assert.equal(header.comments, undefined);
});

test("ssh2 still accepts standard identification strings", () => {
  const header = parseIdentification("SSH-2.0-OpenSSH_9.9 Netcatty");

  assert.equal(header.versions.protocol, "2.0");
  assert.equal(header.versions.software, "OpenSSH_9.9");
  assert.equal(header.comments, "Netcatty");
});

test("ssh2 still rejects malformed identification strings", () => {
  assert.throws(
    () => parseIdentification("SSH-2.0"),
    /Invalid identification string/,
  );
});
