# Netcatty terminal lag investigation: new #2578 evidence and #2581 follow-up

Date: 2026-07-29

Code baseline: `c3067c8dc2aebf7817f1b7c918a6f26dda53414d` from `origin/main`

## Conclusion

- [PR #2581](https://github.com/binaricat/Netcatty/pull/2581) fixes a known repaint bottleneck with dense keyword decorations. It is not a complete fix for [#2578](https://github.com/binaricat/Netcatty/issues/2578).
- The new #2578 screenshot confirms that one Netcatty renderer had about 2,467 MB resident memory during the lag. The reporter also confirmed that the terminals were mostly idle, scrollback was set to 100,000, and enabling hidden-tab hibernation made no noticeable difference.
- The current code had one independently reproducible gap: hidden remote sessions that had already ended could not hibernate, so their complete xterm runtime stayed retained. This directly matches the other report of 4-5 ended terminals left overnight before Netcatty exceeded 2 GB, and supports a narrow fix.
- This gap does not automatically explain the original reporter's 15 terminals, which may still have been connected. A 100,000-line scrollback limit is an important amplifier, but the available evidence does not prove that it is the root cause or that memory is continuously leaking.

## New information from the comments

| Source | New information | What it confirms |
| --- | --- | --- |
| [Original reporter follow-up](https://github.com/binaricat/Netcatty/issues/2578#issuecomment-5113575336) | About five workspaces with about three terminals each; workspace switching, tab switching, and input lag after about three hours; 100,000-line scrollback; terminals mostly idle; hidden-tab hibernation made no noticeable difference. | The field conditions are clearer, and sustained background output is no longer the leading explanation. |
| [Original reporter htop screenshot](https://github.com/binaricat/Netcatty/issues/2578#issuecomment-5113575336) | The selected Netcatty renderer showed RES 2467M, SHR 165M, CPU 3.3%, and MEM 3.8%; total machine memory was about 47.1G of 62.6G. | High resident memory was concentrated in a renderer. A single screenshot cannot separate xterm history, V8, DOM, images, agent content, or other retained resources. |
| [Second user follow-up](https://github.com/binaricat/Netcatty/issues/2578#issuecomment-5113368945) | Netcatty became nearly unusable after exceeding 2 GB on two occasions; about 4-5 terminals and 1-2 agents were open, the sessions were probably ended, and the app was idle overnight across a locked screen. | This is useful independent evidence, but without a screenshot or process split it cannot prove a leak by itself. |
| [Maintainer follow-up](https://github.com/binaricat/Netcatty/issues/2578#issuecomment-5113589065) | Reduce scrollback to 10,000, fully restart, and repeat the same topology for several hours. | This is a proposed control experiment, not a completed result. |

`VIRT` in the screenshot is virtual address space, not physical memory in use. `TIME+` is accumulated CPU time, not application uptime. Electron also reports renderer resident, private, Blink, and V8 heap memory separately, so the next diagnostic step needs a time series rather than another single snapshot. See [Electron ProcessMemoryInfo](https://www.electronjs.org/docs/latest/api/structures/process-memory-info) and [Electron process memory APIs](https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo).

## Relationship to #2251 and #2581

#2581 upgraded `@xterm/xterm` from beta.220 to beta.221 and added a real Electron regression test for dense decorations. Upstream [xterm.js PR #5902](https://github.com/xtermjs/xterm.js/pull/5902) indexed decoration queries by logical line; its published 20,000-decoration scan benchmark fell from 6385.83 ms to 1.80 ms. That change directly addresses the #2251 subproblem where dense keyword highlighting slowed both DOM and WebGL rendering.

#2578 has different field conditions: terminals were mostly idle, the issue appeared after a long run, and renderer resident memory reached about 2.4 GiB. beta.221 can reduce the cost of repainting existing decorations, but it does not release ended sessions, reduce scrollback, or explain renderer memory growth. #2578 should therefore remain open after #2581.

The Linux Electron check added by #2581 did not reach its test logic before or after merge. Electron startup on the GitHub runner first failed the `chrome-sandbox` permission check. The fix is an `ELECTRON_DISABLE_SANDBOX=1` override scoped only to that CI step. See the [first failing check](https://github.com/binaricat/Netcatty/actions/runs/30425243594/job/90490233979).

After the sandbox fix, Electron started, but the hidden BrowserWindow under Xvfb was consistently throttled to about one visual update per second. All three measurements took about 3.05 seconds, which shows a shared display clock limit rather than random performance variance. CI should map the test window on the virtual display while keeping it hidden locally and retaining the original 150 ms threshold. See the [second failing check](https://github.com/binaricat/Netcatty/actions/runs/30426364948/job/90493589196) and [Electron BrowserWindow page visibility documentation](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility).

## Confirmed lifecycle gap

The previous hibernation path required `connected` status at three points:

1. Scheduling hibernation after a tab becomes hidden.
2. Retrying when output has not drained yet.
3. Releasing the xterm runtime after creating the snapshot.

As a result, a remote session that became `disconnected` could not release its runtime even when the tab was hidden and hibernation was enabled. While the tab remained open, its terminal history, renderer objects, and addons stayed owned by the renderer process. See the [scheduling gate](https://github.com/binaricat/Netcatty/blob/c3067c8dc2aebf7817f1b7c918a6f26dda53414d/components/terminal/useTerminalHibernateEffect.ts#L96-L111) and [final gate](https://github.com/binaricat/Netcatty/blob/c3067c8dc2aebf7817f1b7c918a6f26dda53414d/components/Terminal.tsx#L1775-L1858).

Most remote connection exit callbacks also clear the backend session ID before setting status to `disconnected`. A correct fix must therefore allow the ended path to snapshot and release xterm without a live backend ID. Only the still-connected path should require an ID and perform flow-control and listener handoff. See [session exit handling](https://github.com/binaricat/Netcatty/blob/c3067c8dc2aebf7817f1b7c918a6f26dda53414d/components/terminal/runtime/terminalSessionAttachment.ts#L946-L952).

The added hook regression uses a hidden, disconnected, hibernation-enabled session with a live runtime. Before the fix, three consecutive runs produced `onHibernate = 0`; allowing the ended state to hibernate makes the test pass consistently. The fix preserves these boundaries:

- Connected sessions keep the existing flow-control and background-listener handoff.
- Ended sessions fully hibernate and do not consume one of the two soft-hidden renderer slots.
- Ended sessions do not release nonexistent flow control or resubscribe to a dead backend listener.
- If reconnect begins while a snapshot is being created, that hibernation attempt stops. The protection remains active until queued terminal reset work completes and the new connection actually starts.
- An ended session that was already soft-hidden upgrades to full release. A session that ends in Vim, htop, or another alternate-screen app can also release, while connected full-screen apps and sessions containing inline images retain their existing protection.
- If a connected backend ends during snapshot creation, the old snapshot is abandoned so the ended-session retry can drain and preserve the final output.
- A soft-hidden renderer is resumed before an asynchronous full-hibernate upgrade and is restored if the user reveals the tab and cancels that work.
- A visible ended session keeps its display. Showing a hibernated ended session restores its snapshot through the existing offline wake path and leaves it disconnected.

This fixes the second user's explicit ended-session scenario. It does not claim to resolve the original reporter's still-connected multi-terminal scenario.

## Unconfirmed directions

### 100,000-line scrollback

Large scrollback increases the maximum retained history for every terminal and is a clear memory amplifier. A 100,000-line limit does not mean every terminal has filled 100,000 lines. There is no same-machine, same-topology, same-duration comparison between 10,000 and 100,000 yet, so lowering the default or truncating user history would not be an evidence-based fix.

### Long-running leak

The current evidence is one high-memory screenshot plus one independent report without a screenshot. There is no time series for renderer private memory, V8 heap, Blink memory, or the GPU process. Long-lived resource retention is now a justified priority, but a continuous memory leak is not yet confirmed.

### Background output contention

A previous real Electron comparison established that 14 continuously writing background terminals increased active-terminal echo p95 from about 30 ms to more than 100 ms. Retaining only two background renderers returned it to about 30 ms. xterm.js also confirms that multiple instances contend for the same page main thread. See [xterm.js #3368](https://github.com/xtermjs/xterm.js/issues/3368).

This proves that sustained background output is a real performance risk, but the original reporter said the terminals were mostly idle. That stress case cannot be treated as the field root cause here.

## Recommended delivery order

### This narrow PR

- Fix the Linux Electron CI startup issue left by #2581.
- Map the Xvfb performance-test window so a hidden-window display clock does not throttle the measurement.
- Allow hidden, ended remote sessions to release their complete terminal runtime.
- Add regression coverage for status policy, hook scheduling, backend listeners, lifecycle transitions, and cancelled upgrades.
- Do not change scrollback settings, discard output, alter connected-session hibernation semantics, or mark #2578 resolved.

### Follow-up diagnostic PR

Build an automated 5 x 3 terminal matrix that includes at least:

- Scrollback limits of 10,000 and 100,000.
- Idle, low-rate output, and continuous output.
- Connected and ended sessions.
- Hidden-tab hibernation on and off.
- Renderer resident and private memory, Blink and V8 memory, frame intervals, and input-to-display latency.

Short deterministic Electron cases can run in normal CI. Multi-hour soak tests should run manually or on a schedule so they do not delay every PR. Broader behavior changes should wait until this matrix attributes growth to scrollback, terminal history, agents, DOM/GPU resources, or a specific lifecycle.

## Verification record

- Read the #2578 body, all comments, and the attached image pixels through the GitHub API.
- Checked the #2581 merge commit, current `main`, xterm.js #5902, and beta.221 npm metadata.
- Confirmed the hidden-ended-session regression failed consistently in three pre-fix runs and passed after the fix.
- Passed focused tests for hibernation status, ended sessions without a backend ID, reconnect races, soft-hidden upgrades, alternate-screen apps, inline images, hook scheduling, final release, and workflow structure.
- Passed the real Electron dense-decoration test with `ELECTRON_DISABLE_SANDBOX=1`; it created 712 actual keyword decorations, and the slowest refresh with 20,000 decorations was about 50 ms.
- Passed the production build.
- Final full suite: 8,228 tests total, 8,218 passed, 10 skipped, and 0 failed. One earlier run had an intermittent AI network-timeout failure unrelated to this terminal change; that test then passed five consecutive focused runs, and the subsequent complete suites passed.
