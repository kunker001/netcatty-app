'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareTapResults,
  parseTapResult,
} = require('./compare-ci-test-baseline.cjs');

const tap = ({ failures = [], successes = [], fail = failures.length, cancelled = 0, skipped = 0, todo = 0, tests = 10 } = {}) => [
  'TAP version 13',
  ...failures.map((name, index) => `not ok ${index + 1} - ${name}`),
  ...successes.map((name, index) => `ok ${failures.length + index + 1} - ${name}`),
  `# fail ${fail}`,
  `# cancelled ${cancelled}`,
  `# skipped ${skipped}`,
  `# todo ${todo}`,
  `# tests ${tests}`,
].join('\n');

test('accepts a clean candidate even when the base was red', () => {
  const result = compareTapResults(
    parseTapResult(tap({ failures: ['base failure'] }), 1),
    parseTapResult(tap({ successes: ['base failure'] }), 0),
  );
  assert.equal(result.passed, true);
  assert.equal(result.kind, 'clean');
});

test('rejects a zero-exit candidate without a complete clean TAP summary', () => {
  const result = compareTapResults(
    parseTapResult(tap(), 0),
    parseTapResult('custom test command completed', 0),
  );
  assert.equal(result.passed, false);
  assert.equal(result.kind, 'unclassified_failure');
});

test('accepts renaming a successful test when quantitative coverage does not shrink', () => {
  const result = compareTapResults(
    parseTapResult(tap({ successes: ['kept test', 'removed test'] }), 0),
    parseTapResult(tap({ successes: ['kept test', 'unrelated replacement'] }), 0),
  );
  assert.equal(result.passed, true);
  assert.equal(result.kind, 'clean');
  assert.deepEqual(result.missingBaselineSuccesses, ['removed test']);

  const issueNumberName = compareTapResults(
    parseTapResult(tap({
      successes: ['accepts packages that ship upstream #6055/#5987/#6043'],
    }), 0),
    parseTapResult(tap({
      successes: ['accepts packages that ship upstream #9999'],
    }), 0),
  );
  assert.equal(issueNumberName.passed, true);
  assert.equal(issueNumberName.kind, 'clean');

  // Clean candidate that fixes a prior red must keep the failing test title.
  const fixedFailure = compareTapResults(
    parseTapResult(tap({ failures: ['broken test'], successes: ['other test'] }), 1),
    parseTapResult(tap({ successes: ['broken test', 'other test'] }), 0),
  );
  assert.equal(fixedFailure.passed, true);
  assert.equal(fixedFailure.kind, 'clean');

  // Deleting the failing test and adding an unrelated passer is not a clean fix.
  const deletedFailure = compareTapResults(
    parseTapResult(tap({ failures: ['broken test'], successes: ['other test'] }), 1),
    parseTapResult(tap({ successes: ['other test', 'unrelated replacement'] }), 0),
  );
  assert.equal(deletedFailure.passed, false);
  assert.equal(deletedFailure.kind, 'unclassified_failure');
  assert.deepEqual(deletedFailure.missingBaselineFailures, ['broken test']);
});

test('accepts a green candidate that renames one success while adding another', () => {
  const result = compareTapResults(
    parseTapResult(tap({
      successes: ['alpha', 'beta', 'gamma'],
      tests: 8886,
    }), 0),
    parseTapResult(tap({
      successes: ['alpha', 'beta', 'delta', 'epsilon'],
      tests: 8887,
    }), 0),
  );
  assert.equal(result.passed, true);
  assert.equal(result.kind, 'clean');
  assert.deepEqual(result.missingBaselineSuccesses, ['gamma']);
});

test('rejects deleting successful coverage even when the run stays green', () => {
  const result = compareTapResults(
    parseTapResult(tap({ successes: ['kept test', 'removed test'], tests: 12 }), 0),
    parseTapResult(tap({ successes: ['kept test'], tests: 11 }), 0),
  );
  assert.equal(result.passed, false);
  assert.equal(result.kind, 'missing_baseline_successes');
  assert.deepEqual(result.missingBaselineSuccesses, ['removed test']);
  assert.deepEqual(result.newFailures, ['removed test']);
});

test('rejects a clean candidate when the exact-base TAP summary is incomplete (fail closed)', () => {
  const result = compareTapResults(
    parseTapResult('base runner stopped early', 1),
    parseTapResult(tap(), 0),
  );
  assert.equal(result.passed, false);
  assert.equal(result.kind, 'unclassified_failure');
});

test('accepts only failures already present on the exact base', () => {
  const result = compareTapResults(
    parseTapResult(tap({ failures: ['base A', 'base B'] }), 1),
    parseTapResult(tap({ failures: ['base B'], successes: ['base A'] }), 1),
  );
  assert.equal(result.passed, true);
  assert.equal(result.kind, 'baseline_only');
  assert.deepEqual(result.newFailures, []);

  const removedFailure = compareTapResults(
    parseTapResult(tap({ failures: ['base A', 'base B'] }), 1),
    parseTapResult(tap({
      failures: ['base B'],
      successes: ['unrelated replacement'],
    }), 1),
  );
  assert.equal(removedFailure.passed, false);
  assert.equal(removedFailure.kind, 'unclassified_failure');
});

test('rejects a different candidate failure even when both runs are red', () => {
  const result = compareTapResults(
    parseTapResult(tap({ failures: ['base failure'] }), 1),
    parseTapResult(tap({ failures: ['candidate regression'] }), 1),
  );
  assert.equal(result.passed, false);
  assert.equal(result.kind, 'new_failures');
  assert.deepEqual(result.newFailures, ['candidate regression']);
});

test('rejects an additional runner failure after comparable TAP output', () => {
  const sameTap = tap({ failures: ['base failure'] });
  const differentExit = compareTapResults(
    parseTapResult(sameTap, 1),
    parseTapResult(`${sameTap}\nrunner crashed after tests`, 2),
  );
  assert.equal(differentExit.passed, false);
  assert.equal(differentExit.kind, 'unclassified_failure');

  const sameExit = compareTapResults(
    parseTapResult(sameTap, 1),
    parseTapResult(`${sameTap}\nrunner crashed after tests`, 1),
  );
  assert.equal(sameExit.passed, false);
  assert.equal(sameExit.kind, 'unclassified_failure');

  const preSummaryCrash = compareTapResults(
    parseTapResult(sameTap, 1),
    parseTapResult(`runner crashed before summary\n${sameTap}`, 1),
  );
  assert.equal(preSummaryCrash.passed, false);
  assert.equal(preSummaryCrash.kind, 'unclassified_failure');

  const crashWithoutFailureKeyword = compareTapResults(
    parseTapResult(sameTap, 1),
    parseTapResult(`${sameTap}\nSegmentation fault (core dumped)`, 1),
  );
  assert.equal(crashWithoutFailureKeyword.passed, false);
  assert.equal(crashWithoutFailureKeyword.kind, 'unclassified_failure');

  const crashInsideUnattachedYamlMarkers = compareTapResults(
    parseTapResult(sameTap, 1),
    parseTapResult(`${sameTap}\n---\nSegmentation fault (core dumped)\n...`, 1),
  );
  assert.equal(crashInsideUnattachedYamlMarkers.passed, false);
  assert.equal(crashInsideUnattachedYamlMarkers.kind, 'unclassified_failure');

  const diagnosticTap = (closed) => [
    'TAP version 13',
    'not ok 1 - base failure',
    '  ---',
    "  error: 'existing failure'",
    "  code: 'ERR_TEST_FAILURE'",
    ...(closed ? ['  ...'] : []),
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# tests 10',
  ].join('\n');
  const crashAfterUnterminatedDiagnostic = compareTapResults(
    parseTapResult(diagnosticTap(true), 1),
    parseTapResult(`${diagnosticTap(false)}\nSegmentation fault (core dumped)`, 1),
  );
  assert.equal(crashAfterUnterminatedDiagnostic.passed, false);
  assert.equal(crashAfterUnterminatedDiagnostic.kind, 'unclassified_failure');

  const diagnosticWithExtra = (extra) => [
    'TAP version 13',
    'not ok 1 - base failure',
    '  ---',
    "  error: 'existing failure'",
    "  code: 'ERR_TEST_FAILURE'",
    ...(extra ? [`  ${extra}`] : []),
    '  ...',
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# tests 10',
  ].join('\n');
  for (const extra of ['Segmentation fault (core dumped)', 'signal: SIGSEGV']) {
    const crashInsideClosedDiagnostic = compareTapResults(
      parseTapResult(diagnosticWithExtra(''), 1),
      parseTapResult(diagnosticWithExtra(extra), 1),
    );
    assert.equal(crashInsideClosedDiagnostic.passed, false);
    assert.equal(crashInsideClosedDiagnostic.kind, 'new_failures');
  }

  const unchangedArbitraryOutput = compareTapResults(
    parseTapResult(`starting custom runner\n${sameTap}`, 1),
    parseTapResult(`starting custom runner\n${sameTap}`, 1),
  );
  assert.equal(unchangedArbitraryOutput.passed, true);
  assert.equal(unchangedArbitraryOutput.kind, 'baseline_only');
});

test('distinguishes same-title failures by stable TAP diagnostics', () => {
  const withDiagnostic = (error, location = '/workspace/example.test.js:10:1') => [
    'TAP version 13',
    'not ok 1 - duplicate title',
    '  ---',
    `  location: '${location}'`,
    "  failureType: 'testCodeFailure'",
    `  error: '${error}'`,
    "  code: 'ERR_ASSERTION'",
    '  stack: |- ',
    '    volatile stack line',
    '  ...',
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# tests 10',
  ].join('\n');
  const same = compareTapResults(
    parseTapResult(withDiagnostic('old failure'), 1),
    parseTapResult(withDiagnostic('old failure'), 1),
  );
  assert.equal(same.passed, true);

  const moved = compareTapResults(
    parseTapResult(withDiagnostic('old failure'), 1),
    parseTapResult(withDiagnostic('old failure', '/workspace/example.test.js:11:1'), 1),
  );
  assert.equal(moved.passed, true);

  const changed = compareTapResults(
    parseTapResult(withDiagnostic('old failure'), 1),
    parseTapResult(withDiagnostic('new regression'), 1),
  );
  assert.equal(changed.passed, false);
  assert.deepEqual(changed.newFailures, ['duplicate title']);

  const dynamicValues = (actual, nextTitle) => [
    'TAP version 13',
    'not ok 1 - duplicate title',
    '  ---',
    "  location: '/workspace/example.test.js:10:1'",
    "  failureType: 'testCodeFailure'",
    "  error: 'old failure'",
    `  actual: ${actual}`,
    '  expected: 1',
    "  code: 'ERR_ASSERTION'",
    '  stack: |- ',
    '    volatile stack line',
    '  ...',
    `# Subtest: ${nextTitle}`,
    `ok 2 - ${nextTitle}`,
    '1..2',
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# tests 2',
  ].join('\n');
  const dynamic = compareTapResults(
    parseTapResult(dynamicValues(41831, 'later test'), 1),
    parseTapResult(dynamicValues(52942, 'later test'), 1),
  );
  assert.equal(dynamic.passed, true);

  const multilineError = (reason) => [
    'TAP version 13',
    'not ok 1 - duplicate title',
    '  ---',
    "  location: '/workspace/example.test.js:10:1'",
    "  failureType: 'testCodeFailure'",
    '  error: |-',
    `    ${reason}`,
    "  code: 'ERR_ASSERTION'",
    "  operator: 'strictEqual'",
    '  ...',
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# tests 10',
  ].join('\n');
  const changedMultilineError = compareTapResults(
    parseTapResult(multilineError('old failure'), 1),
    parseTapResult(multilineError('new regression'), 1),
  );
  assert.equal(changedMultilineError.passed, false);
  assert.deepEqual(changedMultilineError.newFailures, ['duplicate title']);

  const assertionDiff = (field, actual) => [
    'TAP version 13',
    'not ok 1 - duplicate title',
    '  ---',
    "  failureType: 'testCodeFailure'",
    '  error: |-',
    '    Expected values to be strictly equal:',
    '',
    '    {',
    `      ${field}: ${actual}`,
    '    }',
    "  code: 'ERR_ASSERTION'",
    "  operator: 'strictEqual'",
    '  ...',
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# tests 10',
  ].join('\n');
  const changedAssertionValue = compareTapResults(
    parseTapResult(assertionDiff('now', 111), 1),
    parseTapResult(assertionDiff('now', 222), 1),
  );
  assert.equal(changedAssertionValue.passed, true);

  const changedStableAssertionValue = compareTapResults(
    parseTapResult(assertionDiff('x', 1), 1),
    parseTapResult(assertionDiff('x', 3), 1),
  );
  assert.equal(changedStableAssertionValue.passed, false);

  const changedPortAssertion = compareTapResults(
    parseTapResult(assertionDiff('port', 2222), 1),
    parseTapResult(assertionDiff('port', 443), 1),
  );
  assert.equal(changedPortAssertion.passed, false);

  const customMultilineError = (reason) => multilineError(reason).replace(
    "code: 'ERR_ASSERTION'",
    "code: 'ERR_CUSTOM'",
  );
  const changedCustomError = compareTapResults(
    parseTapResult(customMultilineError('service rejected: old reason'), 1),
    parseTapResult(customMultilineError('service rejected: new reason'), 1),
  );
  assert.equal(changedCustomError.passed, false);

  const sameCustomErrorAcrossRuns = compareTapResults(
    parseTapResult(customMultilineError(
      'service failed at /tmp/run-A/result on 2026-07-31T10:00:00Z in worker.js:10:2',
    ), 1),
    parseTapResult(customMultilineError(
      'service failed at /tmp/run-B/result on 2026-07-31T10:01:00Z in worker.js:11:3',
    ), 1),
  );
  assert.equal(sameCustomErrorAcrossRuns.passed, true);
});

test('rejects added duplicate failures, cancellations, skipped tests, and TODOs', () => {
  const duplicate = compareTapResults(
    parseTapResult(tap({ failures: ['same'] }), 1),
    parseTapResult(tap({ failures: ['same', 'same'] }), 1),
  );
  assert.equal(duplicate.passed, false);

  const cancelled = compareTapResults(
    parseTapResult(tap({ failures: ['same'] }), 1),
    parseTapResult(tap({ failures: ['same'], cancelled: 2 }), 1),
  );
  assert.equal(cancelled.passed, false);
  assert.equal(cancelled.kind, 'cancelled_tests');

  const skipped = compareTapResults(
    parseTapResult(tap({ skipped: 1 }), 0),
    parseTapResult(tap({ skipped: 10 }), 0),
  );
  assert.equal(skipped.passed, false);
  assert.equal(skipped.kind, 'unclassified_failure');

  const todo = compareTapResults(
    parseTapResult(tap({ todo: 1 }), 0),
    parseTapResult(tap({ todo: 10 }), 0),
  );
  assert.equal(todo.passed, false);
  assert.equal(todo.kind, 'unclassified_failure');
});

test('fails closed when a red run has no complete TAP summary', () => {
  const result = compareTapResults(
    parseTapResult('runner stopped early', 1),
    parseTapResult('runner stopped early', 1),
  );
  assert.equal(result.passed, false);
  assert.equal(result.kind, 'unclassified_failure');
});

test('rejects non-test failures and a candidate that runs fewer tests', () => {
  const posttestFailure = compareTapResults(
    parseTapResult(tap({ failures: ['existing'] }), 1),
    parseTapResult(tap({ fail: 0 }), 1),
  );
  assert.equal(posttestFailure.passed, false);
  assert.equal(posttestFailure.kind, 'unclassified_failure');

  const fewerTests = compareTapResults(
    parseTapResult(tap({ failures: ['existing'], tests: 20 }), 1),
    parseTapResult(tap({ failures: ['existing'], tests: 19 }), 1),
  );
  assert.equal(fewerTests.passed, false);
  assert.equal(fewerTests.kind, 'unclassified_failure');
});

test('ignores success-case TAP YAML diagnostics and volatile console noise', () => {
  const withOkDiagnostic = (durationMs, pid, sftpId, requestId, port, mtime) => [
    'TAP version 13',
    `# (node:${pid}) ExperimentalWarning: The MockTimers API is an experimental feature and might change at any time`,
    `#   sftpId: '${sftpId}',`,
    `#   requestId: '${requestId}',`,
    `# OAuth callback server listening on http://127.0.0.1:${port}/oauth/callback`,
    `# [transferDiag] {"event":"progress","id":"${requestId}","pct":1}`,
    `# [FileWatcher] Initial file stats: mtime=${mtime}, size=7`,
    `# [SessionLogStream] Started stream for session-${mtime}-abc -> /tmp/log`,
    'ok 1 - passing helper',
    '  ---',
    `  duration_ms: ${durationMs}`,
    "  type: 'test'",
    '  ...',
    'not ok 2 - base failure',
    '  ---',
    "  error: 'existing failure'",
    "  code: 'ERR_TEST_FAILURE'",
    '  ...',
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# tests 10',
  ].join('\n');

  const result = compareTapResults(
    parseTapResult(
      withOkDiagnostic(1.25, 9089, 'sftp-111261', 'ssh-6239b197-6933-41e3-845b-396a42d6c66b', 37289, 1786091556617.3306),
      1,
    ),
    parseTapResult(
      withOkDiagnostic(9.88, 29926, 'sftp-573391', 'ssh-de14337d-3088-463a-a2ca-ffc93d609e74', 39199, 1786091557152.3345),
      1,
    ),
  );
  assert.equal(result.passed, true);
  assert.equal(result.kind, 'baseline_only');
  assert.deepEqual(result.newFailures, []);
});

test('still rejects new bracket-prefixed runner comments outside transfer diagnostics', () => {
  const sameTap = tap({ failures: ['base failure'] });
  const result = compareTapResults(
    parseTapResult(sameTap, 1),
    parseTapResult(`${sameTap}\n# [fatal] worker aborted after suite`, 1),
  );
  assert.equal(result.passed, false);
  assert.equal(result.kind, 'unclassified_failure');
});
