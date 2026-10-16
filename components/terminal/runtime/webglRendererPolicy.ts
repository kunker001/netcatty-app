/**
 * Decide whether a terminal should postpone creating its WebGL renderer until
 * the pane is actually visible.
 *
 * Every terminal that loads the WebGL addon holds a live WebGL context for its
 * whole lifetime. Batch-connecting several hosts mounts all their panes at once,
 * so without deferral the renderer creates N WebGL contexts back-to-back on the
 * main thread (and N contexts contend for the GPU, which is also the root of the
 * "garbled / 花屏" corruption in #1049/#1063). A pane that mounts hidden does not
 * need a renderer yet — it buffers output via xterm's default DOM renderer and
 * upgrades to WebGL the moment it becomes visible.
 *
 * Visible panes (single connect, the active tab of a batch) keep the current
 * behavior: WebGL is created immediately.
 */
export function shouldDeferWebglUntilVisible(opts: {
  useWebGLAddon: boolean;
  initiallyVisible: boolean;
}): boolean {
  return opts.useWebGLAddon && !opts.initiallyVisible;
}
