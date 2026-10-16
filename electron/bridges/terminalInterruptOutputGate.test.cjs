const test = require("node:test");
const assert = require("node:assert/strict");

const {
  armTerminalInterruptOutputGate,
  filterTerminalInterruptOutput,
  stashPendingInterruptOutputMeta,
  takePendingInterruptOutputMeta,
} = require("./terminalInterruptOutputGate.cjs");

test("pending interrupt metadata clears stale alternate-screen action on later unknown risk", () => {
  const session = {};

  stashPendingInterruptOutputMeta(session, {
    droppedOutputMayAffectTerminalState: true,
    droppedOutputAlternateScreenAction: "leave",
  });
  stashPendingInterruptOutputMeta(session, {
    droppedOutputMayAffectTerminalState: true,
  });

  assert.deepEqual(takePendingInterruptOutputMeta(session), {
    droppedOutputMayAffectTerminalState: true,
  });
});

test("drops flood output after Ctrl+C and resumes from the interrupt echo", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 1000,
    quietMs: 80,
    maxDrainMs: 1000,
  });

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "old output\n", { now: 1001 }),
    { accepted: false, data: "", droppedBytes: 11, reason: "draining" },
  );

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "more old output^C\r\n$ ", { now: 1002 }),
    { accepted: true, data: "^C\r\n$ ", droppedBytes: 15, reason: "interrupt-echo" },
  );

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "next output", { now: 1003 }),
    { accepted: true, data: "next output", droppedBytes: 0, reason: "inactive" },
  );
});

test("resumes output after a quiet gap when no interrupt echo is visible", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 2000,
    quietMs: 80,
    maxDrainMs: 1000,
  });

  assert.equal(filterTerminalInterruptOutput(session, "old output", { now: 2001 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "$ ", { now: 2100 }),
    { accepted: true, data: "$ ", droppedBytes: 0, reason: "prompt-gap" },
  );
});

test("accepts an immediate prompt when the remote does not echo Ctrl+C", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 2500,
    quietMs: 80,
    maxDrainMs: 1000,
  });

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "$ ", { now: 2501 }),
    { accepted: true, data: "$ ", droppedBytes: 0, reason: "prompt-candidate" },
  );

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "next output", { now: 2502 }),
    { accepted: true, data: "next output", droppedBytes: 0, reason: "inactive" },
  );
});

test("resumes output when interrupt echo is split across chunks", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 3500,
    quietMs: 80,
    maxDrainMs: 1000,
  });

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "old output", { now: 3501 }),
    { accepted: false, data: "", droppedBytes: 10, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "^", { now: 3502 }),
    { accepted: false, data: "", droppedBytes: 1, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "C\r\n$ ", { now: 3503 }),
    { accepted: true, data: "^C\r\n$ ", droppedBytes: 0, reason: "interrupt-echo" },
  );
});

test("prompt gap keeps only the prompt suffix and drops stale prefix", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 3600,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 1000,
  });

  assert.equal(filterTerminalInterruptOutput(session, "old output", { now: 3601 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "stale flood\r\n$ ", { now: 3700 }),
    { accepted: true, data: "$ ", droppedBytes: 13, reason: "prompt-gap" },
  );
});

test("preserves alternate-screen exit controls while draining stale output", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 3800,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 1000,
  });

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "stale frame\x1b[?1049l", { now: 3801 }),
    {
      accepted: true,
      data: "\x1b[?1049l",
      droppedBytes: "stale frame".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "more stale\x1b[?25h\r\n$ ", { now: 3900 }),
    {
      accepted: true,
      data: "\x1b[?25h$ ",
      droppedBytes: "more stale\r\n".length,
      reason: "prompt-gap",
    },
  );
});

test("excludes preserved restore controls from held password prefixes", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 3850,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  // Restore sequence is preserved once; password prefix hold must not re-count
  // it, or stale bytes report as 0 dropped and the restore is re-emitted.
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "stale\n\x1b[?1049lPass", { now: 3851 }),
    {
      accepted: true,
      data: "\x1b[?1049l",
      droppedBytes: "stale\n".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "word: ", { now: 3852 }),
    {
      accepted: true,
      data: "Password: ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("excludes the last of multiple preserved restores from held password prefixes", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 3855,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "\x1b[?25hstale\n\x1b[?1049lPass", { now: 3856 }),
    {
      accepted: true,
      data: "\x1b[?25h\x1b[?1049l",
      droppedBytes: "stale\n".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "word: ", { now: 3857 }),
    {
      accepted: true,
      data: "Password: ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("does not peel preserved restore suffix chars from a later password prefix", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 3860,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  // Preserve restore on its own line; next line "login pass" must keep the "l".
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "\x1b[?1049l\nlogin pass", { now: 3861 }),
    {
      accepted: true,
      data: "\x1b[?1049l",
      droppedBytes: 1,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "word: ", { now: 3862 }),
    {
      accepted: true,
      data: "login password: ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("does not leak held incomplete SGR CSI into a later shell prompt", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 3950,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  // Incomplete SGR without a password prefix must be dropped, not held into "$ ".
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "old\x1b[31", { now: 3951 }),
    {
      accepted: false,
      data: "",
      droppedBytes: "old\x1b[31".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "$ ", { now: 4100 }),
    {
      accepted: true,
      data: "$ ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("preserves split alternate-screen exit controls while draining stale output", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 4800,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 1000,
  });

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "stale frame\x1b[?104", { now: 4801 }),
    {
      accepted: false,
      data: "",
      droppedBytes: "stale frame".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "9l^C\r\n$ ", { now: 4802 }),
    {
      accepted: true,
      data: "\x1b[?1049l^C\r\n$ ",
      droppedBytes: 0,
      reason: "interrupt-echo",
    },
  );
});

test("does not preserve unsafe combined private modes while draining stale output", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 4900,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 1000,
  });

  const unsafeSequence = "\x1b[?1049;25h";
  assert.deepEqual(
    filterTerminalInterruptOutput(session, `stale frame${unsafeSequence}^C\r\n$ `, {
      now: 4901,
    }),
    {
      accepted: true,
      data: "^C\r\n$ ",
      droppedBytes: "stale frame".length + unsafeSequence.length,
      reason: "interrupt-echo",
    },
  );
});

test("accepts prompt candidates with OSC title and spaces after stale output", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 5000,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 1000,
  });

  assert.equal(filterTerminalInterruptOutput(session, "old output", { now: 5001 }).accepted, false);
  const prompt = "\x1b]0;~/My Project\x07~/My Project$ ";
  assert.deepEqual(
    filterTerminalInterruptOutput(session, prompt, { now: 5100 }),
    {
      accepted: true,
      data: prompt,
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("accepts split OSC prompt candidates after stale output", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 5200,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 1000,
  });

  assert.deepEqual(
    filterTerminalInterruptOutput(session, "old output\x1b]0;~/My ", { now: 5201 }),
    {
      accepted: false,
      data: "",
      droppedBytes: "old output".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "Project\x07~/My Project$ ", { now: 5300 }),
    {
      accepted: true,
      data: "\x1b]0;~/My Project\x07~/My Project$ ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("keeps draining large chunks after a short quiet gap", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 3000,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 1000,
  });

  assert.equal(filterTerminalInterruptOutput(session, "old output", { now: 3001 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "x".repeat(32768), { now: 3100 }),
    { accepted: false, data: "", droppedBytes: 32768, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "$ ", { now: 3200 }),
    { accepted: true, data: "$ ", droppedBytes: 0, reason: "prompt-gap" },
  );
});

test("accepts a sudo password prompt while draining after Ctrl+C (#2010)", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 6000,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(
    filterTerminalInterruptOutput(session, "Reading package lists...\n", { now: 6001 }).accepted,
    false,
  );
  // One-chunk password prompts must resume before promptQuietMs — they often
  // emit nothing further until the user types (#2010 / Codex P1).
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "[sudo] password for alice: ", { now: 6010 }),
    {
      accepted: true,
      data: "[sudo] password for alice: ",
      droppedBytes: 0,
      reason: "password-prompt",
    },
  );
});

test("accepts bare and localized password prompts while draining (#2010)", () => {
  for (const prompt of [
    "Password: ",
    "[sudo] alice 的密码：",
    "输入密码",
    "Input Password",
    "用户 的密码",
    "密码",
  ]) {
    const session = {};
    armTerminalInterruptOutputGate(session, {
      now: 7000,
      quietMs: 500,
      promptQuietMs: 80,
      maxDrainMs: 2500,
    });
    assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 7001 }).accepted, false);
    assert.deepEqual(
      filterTerminalInterruptOutput(session, prompt, { now: 7010 }),
      {
        accepted: true,
        data: prompt,
        droppedBytes: 0,
        reason: "password-prompt",
      },
      `expected password prompt to resume drain: ${JSON.stringify(prompt)}`,
    );
  }
});

test("does not treat password mentions in ordinary output as prompts", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 8000,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 8001 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "the password was changed", { now: 8100 }),
    { accepted: false, data: "", droppedBytes: 24, reason: "draining" },
  );
});

test("holds a split Password: prompt across chunks while draining (#2010)", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 9000,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9001 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "Pass", { now: 9002 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "word: ", { now: 9003 }),
    {
      accepted: true,
      data: "Password: ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("holds a split ANSI-colored Password: prompt across chunks while draining", () => {
  const session = {};
  const red = "\x1b[31m";
  const reset = "\x1b[0m";

  armTerminalInterruptOutputGate(session, {
    now: 9050,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9051 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, `${red}Pass`, { now: 9052 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, `word:${reset} `, { now: 9053 }),
    {
      accepted: true,
      data: `${red}Password:${reset} `,
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("holds a password prefix split before a trailing ANSI control while draining", () => {
  const session = {};
  const red = "\x1b[31m";
  const reset = "\x1b[0m";

  armTerminalInterruptOutputGate(session, {
    now: 9070,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9071 }).accepted, false);
  // Mid-CSI split: keep both "Pass" and the trailing "\x1b[" so the next chunk
  // can complete the reset + "word:" into a password prompt.
  assert.deepEqual(
    filterTerminalInterruptOutput(session, `${red}Pass\x1b[`, { now: 9072 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, `0mword: `, { now: 9073 }),
    {
      accepted: true,
      data: `${red}Pass${reset}word: `,
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("holds a password prefix split mid CSI parameter while draining", () => {
  const session = {};
  const red = "\x1b[31m";
  const reset = "\x1b[0m";

  armTerminalInterruptOutputGate(session, {
    now: 9080,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9081 }).accepted, false);
  // Incomplete CSI params (ESC[0) must also hold with the password prefix.
  assert.deepEqual(
    filterTerminalInterruptOutput(session, `${red}Pass\x1b[0`, { now: 9082 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, `mword: `, { now: 9083 }),
    {
      accepted: true,
      data: `${red}Pass${reset}word: `,
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("holds a split [sudo] password prompt across chunks while draining (#2010)", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 9100,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9101 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "[sudo] pass", { now: 9102 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "word for alice: ", { now: 9103 }),
    {
      accepted: true,
      data: "[sudo] password for alice: ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("discards a held password prefix that does not complete as a password prompt", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 9200,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9201 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "Pass", { now: 9202 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "$ ", { now: 9400 }),
    {
      accepted: true,
      data: "$ ",
      droppedBytes: 4,
      reason: "prompt-gap",
    },
  );
});

test("discards CSI final bytes when a held mid-CSI password prefix does not complete", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 9220,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9221 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "Pass\x1b[0", { now: 9222 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  // Discard held prefix and the completing "m" so the shell prompt is clean.
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "m$ ", { now: 9400 }),
    {
      accepted: true,
      data: "$ ",
      droppedBytes: "Pass\x1b[0".length + 1,
      reason: "prompt-gap",
    },
  );
});

test("does not hold ordinary password-related output as a prompt prefix", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 9300,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9301 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "Password authentication failed", { now: 9302 }),
    {
      accepted: false,
      data: "",
      droppedBytes: "Password authentication failed".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "$ ", { now: 9500 }),
    {
      accepted: true,
      data: "$ ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("holds split password prompts that have leading text before the keyword", () => {
  const ssh = {};
  armTerminalInterruptOutputGate(ssh, {
    now: 9600,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });
  assert.equal(filterTerminalInterruptOutput(ssh, "stale\n", { now: 9601 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(ssh, "alice@host's pass", { now: 9602 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(ssh, "word: ", { now: 9603 }),
    {
      accepted: true,
      data: "alice@host's password: ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );

  const kylin = {};
  armTerminalInterruptOutputGate(kylin, {
    now: 9700,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });
  assert.equal(filterTerminalInterruptOutput(kylin, "stale\n", { now: 9701 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(kylin, "用户 的密", { now: 9702 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(kylin, "码", { now: 9703 }),
    {
      accepted: true,
      data: "用户 的密码",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("accepts a fresh one-chunk password prompt before the quiet gap", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 9800,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "old flood\n", { now: 9801 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "Password: ", { now: 9810 }),
    {
      accepted: true,
      data: "Password: ",
      droppedBytes: 0,
      reason: "password-prompt",
    },
  );
});

test("accepts a last-line password prompt after a large stale prefix", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 9820,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
    promptCandidateBytes: 512,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9821 }).accepted, false);
  const largeChunk = `${"x".repeat(600)}\n[sudo] password for alice: `;
  assert.deepEqual(
    filterTerminalInterruptOutput(session, largeChunk, { now: 9830 }),
    {
      accepted: true,
      data: "[sudo] password for alice: ",
      droppedBytes: 601,
      reason: "password-prompt",
    },
  );
});

test("does not hold short ASCII trailing letters as password prefixes", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 10000,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 10001 }).accepted, false);
  // Full-width "password：" must not lower ASCII minLen to 1, or "copy p" is held
  // and a later "assword:" chunk can bypass quiet-gap.
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "copy p", { now: 10002 }),
    {
      accepted: false,
      data: "",
      droppedBytes: "copy p".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "assword: ", { now: 10010 }),
    {
      accepted: false,
      data: "",
      droppedBytes: "assword: ".length,
      reason: "draining",
    },
  );
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "$ ", { now: 10200 }),
    {
      accepted: true,
      data: "$ ",
      droppedBytes: 0,
      reason: "prompt-gap",
    },
  );
});

test("rejects held password-prefix completion across a line break", () => {
  const session = {};

  armTerminalInterruptOutputGate(session, {
    now: 9900,
    quietMs: 500,
    promptQuietMs: 80,
    maxDrainMs: 2500,
  });

  assert.equal(filterTerminalInterruptOutput(session, "stale\n", { now: 9901 }).accepted, false);
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "Pass", { now: 9902 }),
    { accepted: false, data: "", droppedBytes: 0, reason: "draining" },
  );
  // A newline before Password: discards the held "Pass" prefix (not a same-line
  // completion), but the fresh complete password line is still preserved.
  assert.deepEqual(
    filterTerminalInterruptOutput(session, "\nPassword: ", { now: 9910 }),
    {
      accepted: true,
      data: "Password: ",
      droppedBytes: 4 + 1,
      reason: "password-prompt",
    },
  );
});
