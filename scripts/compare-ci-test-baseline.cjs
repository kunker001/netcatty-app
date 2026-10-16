'use strict';

const fs = require('node:fs');

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

// Known app/test logger tags that emit volatile `# [Tag] ...` TAP comments on
// every npm test run. Skip these specifically; unknown bracket tags still enter
// nonTapOutput so new runner diagnostics keep failing the gate.
const VOLATILE_TAP_DIAG_TAG_RE = new RegExp(
  '^# \\[(?:'
  + [
    'transferDiag',
    'transferBridge',
    'FileWatcher',
    'SessionLogStream',
    'SSH',
    'SSH Exec',
    'KeyboardInteractive',
    'Telnet',
    'GlobalShortcut',
    'Chain',
    'PortForward',
    'PortForwardingService',
    'SFTP',
    'SFTP Chain',
    'TempDir',
    'Terminal',
    'AutoUpdate',
    'Passphrase',
    'Test',
    'resolve-mosh-bin-release',
    'resolve-et-bin-release',
    'KeywordHighlight',
    'Cursor SDK',
    'Main',
    'vaultBackupBridge',
    'CloudSyncManager',
    'ZMODEM',
    'TrayPanel',
    'sdk',
    'scp-it',
    'Plugins',
    'netcatty-mcp',
    'DirtyEditorGuard',
    'Credentials',
    'afterPack',
  ].map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  + ')\\]',
);

function normalizeNonTapLine(line) {
  return String(line || '')
    .replace(/\(node:\d+\)/g, '(node:<pid>)')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      '<uuid>',
    )
    .replace(/\bsftp-\d+\b/g, 'sftp-<id>')
    .replace(
      /\b(?:requestId|sessionId|transferId|id)\b(['"]?\s*[:=]\s*['"]?)[^'"\s,}\]]+/gi,
      '$1<id>',
    )
    .replace(/https?:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:<port>');
}

function normalizeRuntimeDetail(detail) {
  return detail
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g,
      '<timestamp>',
    )
    .replace(/(?:\/private)?\/var\/folders\/\S+|\/tmp\/\S+/g, '<tmp-path>')
    .replace(/:\d+:\d+\b/g, ':<line>:<column>');
}

function normalizeAssertionDetail(detail) {
  return normalizeRuntimeDetail(detail).replace(
    /\b(now|timestamp|pid|nonce|random(?:Value)?)\b(['"]?\s*[:=]\s*)[^,\s}\]]+/gi,
    '$1$2<volatile>',
  );
}

function normalizeStableDiagnosticDetail(detail) {
  return normalizeAssertionDetail(detail);
}

function collectNonTapOutput(lines) {
  const output = [];
  let inDiagnostic = false;
  let diagnosticOwnerIndent = -1;
  let awaitingDiagnosticIndent = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (inDiagnostic) {
      const indent = rawLine.match(/^\s*/)?.[0].length || 0;
      if (/^\s+\.\.\.\s*$/.test(rawLine) && indent > diagnosticOwnerIndent) {
        inDiagnostic = false;
        diagnosticOwnerIndent = -1;
        continue;
      }
      const boundary = line.match(
        /^(?:(?:ok|not ok) \d+ - |# (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) |1\.\.\d+$)/,
      );
      if (!boundary || indent > diagnosticOwnerIndent) continue;
      output.push('<unterminated-tap-diagnostic>');
      inDiagnostic = false;
      diagnosticOwnerIndent = -1;
    }
    if (awaitingDiagnosticIndent !== null) {
      if (!line) continue;
      const indent = rawLine.match(/^\s*/)?.[0].length || 0;
      if (/^\s+---\s*$/.test(rawLine) && indent > awaitingDiagnosticIndent) {
        inDiagnostic = true;
        diagnosticOwnerIndent = awaitingDiagnosticIndent;
        awaitingDiagnosticIndent = null;
        continue;
      }
      awaitingDiagnosticIndent = null;
    }
    // Node's test runner emits YAML diagnostics after both ok and not ok.
    // Treat both as attached TAP so volatile duration_ms values never look like
    // added runner noise between baseline and candidate runs.
    const tapResult = rawLine.match(/^(\s*)(?:ok|not ok) \d+ - /);
    if (tapResult) {
      awaitingDiagnosticIndent = tapResult[1].length;
      continue;
    }
    if (
      !line ||
      /^TAP version \d+$/.test(line) ||
      /^ok \d+ - /.test(line) ||
      /^# (?:Subtest:|tests |suites |pass |fail |cancelled |skipped |todo |duration_ms )/.test(line) ||
      VOLATILE_TAP_DIAG_TAG_RE.test(line) ||
      /^1\.\.\d+$/.test(line)
    ) {
      continue;
    }
    output.push(
      normalizeNonTapLine(
        line
          .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<timestamp>')
          .replace(/(?:\/private)?\/var\/folders\/\S+|\/tmp\/\S+/g, '<tmp-path>')
          .replace(/:\d+:\d+\b/g, ':<line>:<column>'),
      ),
    );
  }
  if (inDiagnostic) output.push('<unterminated-tap-diagnostic>');
  return output;
}

function parseTapResult(text, exitCode) {
  const normalized = String(text || '').replace(ANSI_RE, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const failures = [];
  const failureRecords = [];
  const successes = [];
  let failCount = null;
  let cancelledCount = null;
  let skippedCount = null;
  let todoCount = null;
  let testCount = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const succeeded = line.match(/^\s*ok \d+ - (.+)$/);
    const tapDirective = /\s+#\s*(?:SKIP|TODO)\b/i;
    if (succeeded && !tapDirective.test(line)) {
      successes.push(succeeded[1].trim());
    }
    const failed = line.match(/^\s*not ok \d+ - (.+)$/);
    if (failed && !tapDirective.test(line)) {
      const name = failed[1].trim();
      const diagnostic = [];
      const errorDetails = [];
      let inDiagnostic = false;
      let errorBlockIndent = -1;
      let skippingStack = false;
      let stackIndent = -1;
      for (let detailIndex = index + 1; detailIndex < lines.length; detailIndex += 1) {
        const detail = lines[detailIndex];
        if (/^\s*(?:ok|not ok) \d+ - /.test(detail) || /^\s*# (?:tests|fail|cancelled|skipped|todo) \d+\s*$/.test(detail)) {
          break;
        }
        if (/^\s*---\s*$/.test(detail)) {
          inDiagnostic = true;
          continue;
        }
        if (inDiagnostic && /^\s*\.\.\.\s*$/.test(detail)) break;
        if (!inDiagnostic) continue;
        const indent = detail.match(/^\s*/)?.[0].length || 0;
        if (errorBlockIndent >= 0) {
          if (!detail.trim()) continue;
          if (indent > errorBlockIndent) {
            errorDetails.push(detail.trim());
            continue;
          }
          errorBlockIndent = -1;
        }
        if (skippingStack) {
          if (!detail.trim() || indent > stackIndent) continue;
          skippingStack = false;
        }
        if (/^\s*stack:\s*(?:\|-)?\s*$/.test(detail)) {
          skippingStack = true;
          stackIndent = indent;
          continue;
        }
        if (/^\s*duration_ms:/.test(detail)) continue;
        if (/^\s*(?:actual|expected):/.test(detail)) continue;
        if (/^\s*error:\s*(?:\|-|>)\s*$/.test(detail)) {
          diagnostic.push('error:');
          errorBlockIndent = indent;
          continue;
        }
        if (detail.trim()) {
          diagnostic.push(normalizeStableDiagnosticDetail(detail.trimEnd()));
        }
      }
      const assertionFailure = diagnostic.some((detail) =>
        /^\s*code:\s*['"]?ERR_ASSERTION['"]?\s*$/.test(detail),
      );
      const stableErrorDetails = assertionFailure
        ? errorDetails.map(normalizeStableDiagnosticDetail)
        : errorDetails.map(normalizeRuntimeDetail);
      diagnostic.push(...stableErrorDetails.map((detail) => `error-detail: ${detail}`));
      failures.push(name);
      failureRecords.push({
        name,
        identity: diagnostic.length ? `${name}\n${diagnostic.join('\n')}` : name,
      });
    }
    const failSummary = line.match(/^\s*# fail (\d+)\s*$/);
    if (failSummary) {
      failCount = Number(failSummary[1]);
    }
    const cancelledSummary = line.match(/^\s*# cancelled (\d+)\s*$/);
    if (cancelledSummary) {
      cancelledCount = Number(cancelledSummary[1]);
    }
    const skippedSummary = line.match(/^\s*# skipped (\d+)\s*$/);
    if (skippedSummary) {
      skippedCount = Number(skippedSummary[1]);
    }
    const todoSummary = line.match(/^\s*# todo (\d+)\s*$/);
    if (todoSummary) {
      todoCount = Number(todoSummary[1]);
    }
    const testSummary = line.match(/^\s*# tests (\d+)\s*$/);
    if (testSummary) {
      testCount = Number(testSummary[1]);
    }
  }
  return {
    exitCode: Number(exitCode),
    failures,
    failureRecords,
    successes,
    failCount,
    cancelledCount,
    skippedCount,
    todoCount,
    testCount,
    nonTapOutput: collectNonTapOutput(lines),
    complete:
      failCount !== null &&
      cancelledCount !== null &&
      skippedCount !== null &&
      todoCount !== null &&
      testCount !== null,
  };
}

function countFailures(failures) {
  const counts = new Map();
  for (const failure of failures) {
    counts.set(failure, (counts.get(failure) || 0) + 1);
  }
  return counts;
}

function compareTapResults(baseline, candidate) {
  const baselineSuccessCounts = countFailures(baseline.successes);
  const candidateSuccessCounts = countFailures(candidate.successes);
  const candidateSuccessPool = new Map(candidateSuccessCounts);
  const missingBaselineSuccesses = [];
  for (const [success, count] of baselineSuccessCounts) {
    const available = candidateSuccessPool.get(success) || 0;
    const missing = count - available;
    candidateSuccessPool.set(success, Math.max(0, available - count));
    for (let i = 0; i < missing; i += 1) missingBaselineSuccesses.push(success);
  }
  const candidateFailurePool = countFailures(
    candidate.failureRecords.map((failure) => failure.identity),
  );
  const missingBaselineFailures = [];
  for (const failure of baseline.failureRecords) {
    const matchingFailures = candidateFailurePool.get(failure.identity) || 0;
    if (matchingFailures > 0) {
      candidateFailurePool.set(failure.identity, matchingFailures - 1);
      continue;
    }
    const matchingSuccesses = candidateSuccessPool.get(failure.name) || 0;
    if (matchingSuccesses > 0) {
      candidateSuccessPool.set(failure.name, matchingSuccesses - 1);
      continue;
    }
    missingBaselineFailures.push(failure.name);
  }

  const result = ({
    passed,
    kind,
    newFailures = [],
    candidateFailures = candidate.exitCode === 0 ? [] : candidate.failures,
  }) => ({
    passed,
    kind,
    baselineFailures: baseline.failures,
    candidateFailures,
    newFailures,
    missingBaselineSuccesses,
    missingBaselineFailures,
  });

  if (candidate.exitCode === 0) {
    // Require every baseline failure title to reappear as a same-named success
    // before accepting a red-to-green transition. Aggregate counts alone would allow
    // deleting the failing test and adding an unrelated passer.
    const baselineFailCounts = countFailures(baseline.failures);
    const baselineSuccessCountsForFix = countFailures(baseline.successes);
    const candidateSuccessCountsForFix = countFailures(candidate.successes);
    const unresolvedBaselineFailures = [];
    for (const [name, failCount] of baselineFailCounts) {
      const required =
        failCount + (baselineSuccessCountsForFix.get(name) || 0);
      const available = candidateSuccessCountsForFix.get(name) || 0;
      for (let i = 0; i < required - available; i += 1) {
        unresolvedBaselineFailures.push(name);
      }
    }
    // A fully green candidate may rename success titles when quantitative
    // coverage does not shrink, but only against a complete baseline summary.
    // An incomplete baseline cannot prove coverage was preserved, so fail closed.
    const quantitativeClean =
      baseline.complete &&
      candidate.complete &&
      candidate.failCount === 0 &&
      candidate.cancelledCount === 0 &&
      unresolvedBaselineFailures.length === 0 &&
      candidate.skippedCount <= baseline.skippedCount &&
      candidate.todoCount <= baseline.todoCount &&
      candidate.testCount >= baseline.testCount;
    if (quantitativeClean) {
      return result({ passed: true, kind: 'clean' });
    }
    const coverageShrunk =
      baseline.complete &&
      candidate.complete &&
      candidate.failCount === 0 &&
      candidate.cancelledCount === 0 &&
      candidate.skippedCount <= baseline.skippedCount &&
      candidate.todoCount <= baseline.todoCount &&
      candidate.testCount < baseline.testCount &&
      missingBaselineSuccesses.length > 0;
    if (coverageShrunk) {
      return result({
        passed: false,
        kind: 'missing_baseline_successes',
        newFailures: missingBaselineSuccesses,
      });
    }
    return result({
      passed: false,
      kind: 'unclassified_failure',
      newFailures: unresolvedBaselineFailures.length
        ? unresolvedBaselineFailures
        : missingBaselineSuccesses,
    });
  }

  if (baseline.exitCode === 0) {
    return result({
      passed: false,
      kind: 'new_failures',
      candidateFailures: candidate.failures,
      newFailures: candidate.failures,
    });
  }

  if (!baseline.complete || !candidate.complete) {
    return result({
      passed: false,
      kind: 'unclassified_failure',
      candidateFailures: candidate.failures,
      newFailures: candidate.failures,
    });
  }

  if (missingBaselineSuccesses.length) {
    return result({
      passed: false,
      kind: 'missing_baseline_successes',
      candidateFailures: candidate.failures,
      newFailures: missingBaselineSuccesses,
    });
  }

  if (candidate.exitCode !== baseline.exitCode) {
    return result({
      passed: false,
      kind: 'unclassified_failure',
      candidateFailures: candidate.failures,
      newFailures: candidate.failures,
    });
  }

  const baselineNonTapCounts = countFailures(baseline.nonTapOutput);
  const candidateNonTapCounts = countFailures(candidate.nonTapOutput);
  const addedNonTapOutput = [...candidateNonTapCounts].some(
    ([line, count]) => count > (baselineNonTapCounts.get(line) || 0),
  );
  if (addedNonTapOutput) {
    return result({
      passed: false,
      kind: 'unclassified_failure',
      candidateFailures: candidate.failures,
      newFailures: candidate.failures,
    });
  }

  if (candidate.failCount === 0 || candidate.testCount < baseline.testCount) {
    return result({
      passed: false,
      kind: 'unclassified_failure',
      candidateFailures: candidate.failures,
      newFailures: candidate.failures,
    });
  }

  if (
    candidate.cancelledCount > 0 ||
    candidate.skippedCount > baseline.skippedCount ||
    candidate.todoCount > baseline.todoCount
  ) {
    return result({
      passed: false,
      kind: 'cancelled_tests',
      candidateFailures: candidate.failures,
      newFailures: candidate.failures,
    });
  }

  const baselineCounts = countFailures(
    baseline.failureRecords.map((failure) => failure.identity),
  );
  const candidateCounts = countFailures(
    candidate.failureRecords.map((failure) => failure.identity),
  );
  const newFailures = [];
  for (const [identity, count] of candidateCounts) {
    const extra = count - (baselineCounts.get(identity) || 0);
    const name = candidate.failureRecords.find(
      (failure) => failure.identity === identity,
    )?.name || identity;
    for (let i = 0; i < extra; i += 1) newFailures.push(name);
  }
  const parsedCountsMatch =
    baseline.failureRecords.length >= Number(baseline.failCount) &&
    candidate.failureRecords.length >= Number(candidate.failCount);
  const passed =
    newFailures.length === 0 &&
    missingBaselineFailures.length === 0 &&
    parsedCountsMatch;
  const reportedFailures = newFailures.length
    ? newFailures
    : missingBaselineFailures;
  return result({
    passed,
    kind: passed
      ? 'baseline_only'
      : newFailures.length
        ? 'new_failures'
        : 'unclassified_failure',
    candidateFailures: candidate.failures,
    newFailures: reportedFailures,
  });
}

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--') || argv[i + 1] === undefined) {
      throw new Error('Expected --name value arguments.');
    }
    values[key.slice(2)] = argv[i + 1];
  }
  return values;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  for (const required of [
    'baseline-log',
    'baseline-exit',
    'candidate-log',
    'candidate-exit',
    'output',
  ]) {
    if (!(required in args)) throw new Error(`Missing --${required}.`);
  }
  const baseline = parseTapResult(
    fs.readFileSync(args['baseline-log'], 'utf8'),
    args['baseline-exit'],
  );
  const candidate = parseTapResult(
    fs.readFileSync(args['candidate-log'], 'utf8'),
    args['candidate-exit'],
  );
  const result = compareTapResults(baseline, candidate);
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(
    result.passed
      ? `Test comparison accepted: ${result.kind}.`
      : `Test comparison failed: ${result.kind}.`,
  );
  if (result.newFailures.length) {
    console.error(`New failures:\n- ${result.newFailures.join('\n- ')}`);
  }
  if (!result.passed && result.missingBaselineSuccesses?.length) {
    console.error(
      `Missing baseline successes:\n- ${result.missingBaselineSuccesses.join('\n- ')}`,
    );
  }
  return result.passed ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

module.exports = {
  compareTapResults,
  main,
  parseTapResult,
};
