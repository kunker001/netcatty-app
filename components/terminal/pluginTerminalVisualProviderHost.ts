import type { IDecoration, IDisposable, IMarker, Terminal as XTerm } from '@xterm/xterm';

import {
  normalizePluginBackgroundResult,
  normalizePluginBackgroundRefreshAfterMs,
  normalizePluginMatcherResult,
  normalizePluginPromptResult,
  normalizePluginSemanticResult,
  type PluginTerminalAnnotation,
} from '../../domain/pluginTerminalProviders';
import {
  waitForPluginTerminalProviderResponse,
  type PluginTerminalProviderCallResponse,
  type RequestPluginTerminalProviders,
} from './pluginTerminalLinkProvider';
import {
  pluginTerminalCellRange,
  readPluginTerminalBufferText,
  type PluginTerminalBufferText,
} from './pluginTerminalBufferText';
import { detectPrompt } from './autocomplete/promptDetector';

const MATCHER_QUIET_MS = 220;
const PROVIDER_DEADLINE_MS = 1_000;
const PROVIDER_RESPONSE_TIMEOUT_MS = 1_200;
const MAX_VISIBLE_ANNOTATIONS = 8;
const MAX_MATCHER_LINES = 32;
const MAX_MATCHER_PHYSICAL_LINES = 256;
const MAX_MATCHER_BATCH_CHARS = 96 * 1024;

const severityColors = Object.freeze({
  info: '#60a5fa',
  warning: '#f59e0b',
  error: '#ef4444',
  success: '#22c55e',
});

interface MatcherLine {
  readonly lineId: string;
  readonly line: string;
  readonly bufferLineNumber: number;
  readonly segments: readonly {
    absoluteY: number;
    start: number;
    length: number;
    text: PluginTerminalBufferText;
  }[];
}

function recentLogicalLines(term: XTerm): readonly MatcherLine[] {
  const buffer = term.buffer.active;
  const lastAbsoluteY = buffer.baseY + buffer.cursorY;
  let firstAbsoluteY = Math.max(0, lastAbsoluteY - MAX_MATCHER_PHYSICAL_LINES + 1);
  while (firstAbsoluteY > 0
    && lastAbsoluteY - firstAbsoluteY < MAX_MATCHER_PHYSICAL_LINES
    && buffer.getLine(firstAbsoluteY)?.isWrapped) {
    firstAbsoluteY -= 1;
  }
  const lines: MatcherLine[] = [];
  let skipPartialLogicalLine = buffer.getLine(firstAbsoluteY)?.isWrapped === true;
  let current: {
    startAbsoluteY: number;
    line: string;
    segments: Array<{
      absoluteY: number;
      start: number;
      length: number;
      text: PluginTerminalBufferText;
    }>;
  } | null = null;
  for (let absoluteY = firstAbsoluteY; absoluteY <= lastAbsoluteY; absoluteY += 1) {
    const bufferLine = buffer.getLine(absoluteY);
    if (!bufferLine) continue;
    if (skipPartialLogicalLine) {
      if (bufferLine.isWrapped) continue;
      skipPartialLogicalLine = false;
    }
    if (!bufferLine.isWrapped || !current) {
      if (current?.line && current.line.length <= 8_192) {
        const endAbsoluteY = current.segments.at(-1)?.absoluteY ?? current.startAbsoluteY;
        lines.push({
          lineId: `${current.startAbsoluteY}:${endAbsoluteY}`,
          line: current.line,
          bufferLineNumber: current.startAbsoluteY + 1,
          segments: Object.freeze(current.segments),
        });
      }
      current = { startAbsoluteY: absoluteY, line: '', segments: [] };
    }
    const nextIsWrapped = buffer.getLine(absoluteY + 1)?.isWrapped === true;
    const segment = readPluginTerminalBufferText(bufferLine, !nextIsWrapped);
    const start = current.line.length;
    current.line += segment.text;
    current.segments.push({ absoluteY, start, length: segment.text.length, text: segment });
  }
  if (current?.line && current.line.length <= 8_192) {
    const endAbsoluteY = current.segments.at(-1)?.absoluteY ?? current.startAbsoluteY;
    lines.push({
      lineId: `${current.startAbsoluteY}:${endAbsoluteY}`,
      line: current.line,
      bufferLineNumber: current.startAbsoluteY + 1,
      segments: Object.freeze(current.segments),
    });
  }
  const selected: MatcherLine[] = [];
  let characterCount = 0;
  for (const line of lines.slice(-MAX_MATCHER_LINES).reverse()) {
    if (characterCount + line.line.length > MAX_MATCHER_BATCH_CHARS) break;
    selected.unshift(line);
    characterCount += line.line.length;
  }
  return Object.freeze(selected);
}

function currentPromptLine(term: XTerm): { line: string; bufferLineNumber: number } | null {
  const prompt = detectPrompt(term);
  if (!prompt.isAtPrompt || prompt.userInput.length > 0) return null;
  const buffer = term.buffer.active;
  const absoluteY = buffer.baseY + buffer.cursorY;
  const line = prompt.promptText.trimEnd();
  if (!line || line.length > 8_192) return null;
  return { line, bufferLineNumber: absoluteY + 1 };
}

function disposeAll(values: Array<IDisposable | undefined>): void {
  for (const value of values.splice(0)) {
    try { value?.dispose(); } catch { /* isolate xterm decoration cleanup */ }
  }
}

export class PluginTerminalVisualProviderHost implements IDisposable {
  readonly #term: XTerm;
  readonly #request: RequestPluginTerminalProviders;
  readonly #disposables: IDisposable[] = [];
  readonly #matcherDecorations: Array<IDecoration | IMarker | undefined> = [];
  readonly #annotationDecorations: Array<IDecoration | IMarker | undefined> = [];
  #visibleAnnotations: readonly PluginTerminalAnnotation[] = Object.freeze([]);
  #annotationAnchorLine: number | null = null;
  #annotationMarker: IMarker | null = null;
  readonly #requestControllers = new Set<AbortController>();
  readonly #matcherRequestControllers = new Set<AbortController>();
  #matcherTimer: ReturnType<typeof setTimeout> | undefined;
  #matcherGeneration = 0;
  #annotationGeneration = 0;
  #backgroundGeneration = 0;
  readonly #pendingSemantics: Array<{
    annotations: readonly PluginTerminalAnnotation[];
    ready: Promise<void>;
  }> = [];
  #backgroundOverlay: HTMLDivElement | null = null;
  #backgroundTimer: ReturnType<typeof setTimeout> | undefined;
  #terminalBackground: string | undefined;
  #active: boolean;
  #visible: boolean;
  #reducedMotion: boolean;
  readonly #isProviderAvailable: (kind: NetcattyTerminalProviderKind) => boolean;
  #providerAvailabilityGeneration = 0;
  #disposed = false;
  readonly #matcherQuietMs: number;
  readonly #providerResponseTimeoutMs: number;

  constructor(options: {
    term: XTerm;
    request: RequestPluginTerminalProviders;
    matcherQuietMs?: number;
    providerResponseTimeoutMs?: number;
    terminalBackground?: string;
    active?: boolean;
    visible?: boolean;
    reducedMotion?: boolean;
    isProviderAvailable?(kind: NetcattyTerminalProviderKind): boolean;
  }) {
    this.#term = options.term;
    this.#request = options.request;
    this.#matcherQuietMs = options.matcherQuietMs ?? MATCHER_QUIET_MS;
    this.#providerResponseTimeoutMs = options.providerResponseTimeoutMs ?? PROVIDER_RESPONSE_TIMEOUT_MS;
    this.#terminalBackground = options.terminalBackground;
    this.#active = options.active ?? true;
    this.#visible = options.visible ?? true;
    const reducedMotionQuery = options.reducedMotion === undefined
      && typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    this.#reducedMotion = options.reducedMotion ?? reducedMotionQuery?.matches ?? false;
    if (reducedMotionQuery) {
      const onReducedMotionChanged = (event: MediaQueryListEvent) => {
        this.#reducedMotion = event.matches;
        clearTimeout(this.#backgroundTimer);
        this.#backgroundTimer = undefined;
        if (!event.matches && this.#active && this.#visible) {
          void this.refreshBackground('reduced-motion-changed', this.#terminalBackground);
        }
      };
      reducedMotionQuery.addEventListener('change', onReducedMotionChanged);
      this.#disposables.push({
        dispose: () => reducedMotionQuery.removeEventListener('change', onReducedMotionChanged),
      });
    }
    this.#isProviderAvailable = options.isProviderAvailable ?? (() => true);
    this.#disposables.push(this.#term.onWriteParsed(() => {
      if (this.#annotationMarker && !this.#annotationMarker.isDisposed) {
        this.#annotationAnchorLine = this.#annotationMarker.line;
      }
      this.#matcherGeneration += 1;
      for (const controller of this.#matcherRequestControllers) controller.abort();
      this.#matcherRequestControllers.clear();
      disposeAll(this.#matcherDecorations);
      this.#scheduleMatcherRefresh();
    }));
    if (this.#active && this.#visible && this.#isProviderAvailable('terminal.background')) {
      void this.refreshBackground('runtime-created', options.terminalBackground);
    }
  }

  async #requestWithTimeout(
    kind: NetcattyTerminalProviderKind,
    operation: string,
    payload: Readonly<Record<string, unknown>>,
    supersessionKey?: string,
  ): Promise<PluginTerminalProviderCallResponse> {
    const controller = new AbortController();
    this.#requestControllers.add(controller);
    if (kind === 'terminal.matcher') this.#matcherRequestControllers.add(controller);
    try {
      return await waitForPluginTerminalProviderResponse(
        this.#request(
          kind,
          operation,
          payload,
          PROVIDER_DEADLINE_MS,
          supersessionKey,
          controller.signal,
        ),
        this.#providerResponseTimeoutMs,
        () => controller.abort(),
      );
    } finally {
      this.#requestControllers.delete(controller);
      this.#matcherRequestControllers.delete(controller);
    }
  }

  #abortProviderRequests(): void {
    for (const controller of this.#requestControllers) controller.abort();
    this.#requestControllers.clear();
    this.#matcherRequestControllers.clear();
  }

  async commandSubmitted(command: string): Promise<void> {
    if (this.#disposed || !this.#active || !this.#visible || !this.#isProviderAvailable('terminal.semantic')
      || command.length < 1 || command.length > 4_096) return;
    if (this.#pendingSemantics.length >= 64) return;
    const providerGeneration = this.#providerAvailabilityGeneration;
    let resolveReady: (() => void) | undefined;
    const pending = {
      annotations: Object.freeze([]) as readonly PluginTerminalAnnotation[],
      ready: new Promise<void>((resolve) => { resolveReady = resolve; }),
    };
    this.#pendingSemantics.push(pending);
    try {
      const response = await this.#requestWithTimeout(
          'terminal.semantic',
          'provideSemantics',
          { command },
      );
      if (this.#disposed || !this.#active || !this.#visible || response.stale
        || providerGeneration !== this.#providerAvailabilityGeneration) return;
      const annotations = response.results.flatMap((result) => {
        if (result.status !== 'ok') return [];
        const semantic = normalizePluginSemanticResult(result.providerId, result.result);
        const summary = semantic.classification
          ? [{
              text: semantic.destructive
                ? `[destructive] ${semantic.classification}`
                : semantic.classification,
              ...(semantic.destructive ? { color: severityColors.error } : {}),
              ...(semantic.description ? { description: semantic.description } : {}),
              providerId: result.providerId,
            }]
          : [];
        return [...summary, ...semantic.annotations];
      });
      pending.annotations = Object.freeze(annotations.slice(0, MAX_VISIBLE_ANNOTATIONS));
    } catch { /* a missing semantic result leaves this command unannotated */ }
    finally { resolveReady?.(); }
  }

  async commandCompleted(): Promise<void> {
    if (this.#disposed || !this.#active || !this.#visible) return;
    const generation = ++this.#annotationGeneration;
    const pendingSemantic = this.#pendingSemantics.shift();
    await pendingSemantic?.ready;
    if (this.#disposed || !this.#active || !this.#visible
      || generation !== this.#annotationGeneration) return;
    const semanticAnnotations = pendingSemantic?.annotations ?? Object.freeze([]);
    if (!this.#isProviderAvailable('terminal.prompt')) {
      this.#renderAnnotations(semanticAnnotations);
      return;
    }
    const prompt = currentPromptLine(this.#term);
    try {
      const response = await this.#requestWithTimeout(
          'terminal.prompt',
          'provideAnnotations',
          {
            reason: 'commandCompleted',
            ...(prompt ? { promptLine: prompt.line, bufferLineNumber: prompt.bufferLineNumber } : {}),
          },
      );
      if (this.#disposed || !this.#active || !this.#visible || response.stale
        || generation !== this.#annotationGeneration) return;
      const promptAnnotations = response.results.flatMap((result) => result.status === 'ok'
        ? normalizePluginPromptResult(result.providerId, result.result)
        : []);
      this.#renderAnnotations([...semanticAnnotations, ...promptAnnotations].slice(0, MAX_VISIBLE_ANNOTATIONS));
    } catch {
      if (!this.#disposed && this.#active && this.#visible
        && generation === this.#annotationGeneration) {
        this.#renderAnnotations(semanticAnnotations);
      }
    }
  }

  async refreshBackground(reason: string, terminalBackground?: string): Promise<void> {
    if (terminalBackground) this.#terminalBackground = terminalBackground;
    clearTimeout(this.#backgroundTimer);
    this.#backgroundTimer = undefined;
    if (this.#disposed || !this.#active || !this.#visible
      || !this.#isProviderAvailable('terminal.background')) {
      this.#renderBackground([]);
      return;
    }
    const generation = ++this.#backgroundGeneration;
    try {
      const response = await this.#requestWithTimeout(
          'terminal.background',
          'provideBackgrounds',
          { reason, ...(terminalBackground ? { terminalBackground } : {}) },
      );
      if (this.#disposed || !this.#active || !this.#visible || response.stale
        || generation !== this.#backgroundGeneration) return;
      const layers = response.results.flatMap((result) => result.status === 'ok'
        ? normalizePluginBackgroundResult(result.providerId, result.result)
        : []).slice(0, 4);
      this.#renderBackground(layers.map((layer) => ({ color: layer.color, opacity: layer.opacity })));
      if (!this.#reducedMotion) {
        const refreshAfterMs = response.results.reduce<number | undefined>((minimum, result) => {
          if (result.status !== 'ok') return minimum;
          const next = normalizePluginBackgroundRefreshAfterMs(result.result);
          return next === undefined ? minimum : Math.min(minimum ?? next, next);
        }, undefined);
        if (refreshAfterMs !== undefined) {
          this.#backgroundTimer = setTimeout(() => {
            this.#backgroundTimer = undefined;
            void this.refreshBackground('scheduled', this.#terminalBackground);
          }, refreshAfterMs);
        }
      }
    } catch {
      if (!this.#disposed && this.#active && this.#visible
        && generation === this.#backgroundGeneration) this.#renderBackground([]);
    }
  }

  #scheduleMatcherRefresh(): void {
    if (this.#disposed || !this.#active || !this.#visible
      || !this.#isProviderAvailable('terminal.matcher')) return;
    clearTimeout(this.#matcherTimer);
    this.#matcherTimer = setTimeout(() => { void this.#refreshMatchers(); }, this.#matcherQuietMs);
  }

  async #refreshMatchers(): Promise<void> {
    this.#matcherTimer = undefined;
    if (this.#disposed || !this.#active || !this.#visible
      || !this.#isProviderAvailable('terminal.matcher')) return;
    if (this.#term.buffer.active.type === 'alternate') {
      disposeAll(this.#matcherDecorations);
      return;
    }
    const lines = recentLogicalLines(this.#term);
    if (lines.length === 0) return;
    const lineLengths = new Map(lines.map((line) => [line.lineId, line.line.length]));
    const matcherLines = new Map(lines.map((line) => [line.lineId, line]));
    const generation = ++this.#matcherGeneration;
    try {
      const response = await this.#requestWithTimeout(
          'terminal.matcher',
          'provideMatches',
          { lines: lines.map(({ lineId, line, bufferLineNumber }) => ({ lineId, line, bufferLineNumber })) },
      );
      if (this.#disposed || !this.#active || !this.#visible || response.stale
        || generation !== this.#matcherGeneration) return;
      if (this.#term.buffer.active.type === 'alternate') {
        disposeAll(this.#matcherDecorations);
        return;
      }
      const matches = response.results.flatMap((result) => result.status === 'ok'
        ? normalizePluginMatcherResult(result.providerId, result.result, lineLengths)
        : []).slice(0, 64);
      disposeAll(this.#matcherDecorations);
      const cursorAbsoluteY = this.#term.buffer.active.baseY + this.#term.buffer.active.cursorY;
      for (const match of matches) {
        const line = matcherLines.get(match.lineId);
        if (!line) continue;
        const matchEnd = match.start + match.length;
        for (const segment of line.segments) {
          const segmentEnd = segment.start + segment.length;
          const overlapStart = Math.max(match.start, segment.start);
          const overlapEnd = Math.min(matchEnd, segmentEnd);
          if (overlapStart >= overlapEnd) continue;
          const cellRange = pluginTerminalCellRange(
            segment.text,
            overlapStart - segment.start,
            overlapEnd - overlapStart,
          );
          if (!cellRange) continue;
          const marker = this.#term.registerMarker(segment.absoluteY - cursorAbsoluteY);
          if (!marker) continue;
          const decoration = this.#term.registerDecoration({
            marker,
            x: cellRange.x,
            width: cellRange.width,
            foregroundColor: match.color ?? severityColors[match.severity],
            layer: 'top',
          });
          decoration?.onRender((element) => {
            element.setAttribute('aria-label', match.label);
            element.title = match.label;
          });
          this.#matcherDecorations.push(decoration, marker);
        }
      }
    } catch {
      if (this.#active && this.#visible && generation === this.#matcherGeneration) {
        disposeAll(this.#matcherDecorations);
      }
    }
  }

  #renderAnnotations(
    annotations: readonly PluginTerminalAnnotation[],
    anchorLine?: number | null,
  ): void {
    disposeAll(this.#annotationDecorations);
    this.#annotationMarker = null;
    this.#visibleAnnotations = Object.freeze([...annotations]);
    if (annotations.length === 0 || this.#disposed || !this.#active || !this.#visible) {
      this.#annotationAnchorLine = null;
      return;
    }
    const buffer = this.#term.buffer.active;
    const cursorLine = buffer.baseY + buffer.cursorY;
    const marker = this.#term.registerMarker((anchorLine ?? cursorLine) - cursorLine);
    if (!marker) return;
    this.#annotationMarker = marker;
    this.#annotationAnchorLine = marker.line;
    const decoration = this.#term.registerDecoration({ marker, anchor: 'right', x: 0, width: 1, layer: 'top' });
    const text = annotations.map((annotation) => annotation.text).join(' | ').slice(0, 512);
    const description = annotations.map((annotation) => annotation.description).filter(Boolean).join('\n');
    decoration?.onRender((element) => {
      element.className = 'pointer-events-none max-w-[50%] overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium';
      element.textContent = text;
      element.setAttribute('role', 'note');
      element.setAttribute('aria-label', text);
      if (description) element.title = description;
      element.style.color = annotations[0]?.color ?? 'var(--muted-foreground)';
      element.style.width = 'max-content';
      element.style.maxWidth = '50%';
      element.style.transform = 'translateX(calc(-100% - 4px))';
    });
    this.#annotationDecorations.push(decoration, marker);
  }

  /** Recreate markers disposed by a terminal history replay without re-querying plugins. */
  terminalRebuilt(): void {
    if (this.#visibleAnnotations.length === 0) return;
    this.#renderAnnotations(this.#visibleAnnotations, this.#annotationAnchorLine);
  }

  #clearAnnotations(): void {
    disposeAll(this.#annotationDecorations);
    this.#annotationMarker = null;
    this.#visibleAnnotations = Object.freeze([]);
    this.#annotationAnchorLine = null;
  }

  setActive(active: boolean, terminalBackground?: string): void {
    if (this.#disposed || this.#active === active) {
      if (active && terminalBackground) void this.refreshBackground('theme-changed', terminalBackground);
      return;
    }
    this.#active = active;
    if (active) {
      void this.refreshBackground('session-connected', terminalBackground);
      this.#scheduleMatcherRefresh();
      return;
    }
    clearTimeout(this.#matcherTimer);
    clearTimeout(this.#backgroundTimer);
    this.#matcherTimer = undefined;
    this.#backgroundTimer = undefined;
    this.#abortProviderRequests();
    this.#matcherGeneration += 1;
    this.#annotationGeneration += 1;
    this.#backgroundGeneration += 1;
    this.#pendingSemantics.splice(0);
    disposeAll(this.#matcherDecorations);
    this.#clearAnnotations();
    this.#renderBackground([]);
  }

  setVisible(visible: boolean, terminalBackground?: string): void {
    if (this.#disposed || this.#visible === visible) return;
    this.#visible = visible;
    clearTimeout(this.#backgroundTimer);
    clearTimeout(this.#matcherTimer);
    this.#backgroundTimer = undefined;
    this.#matcherTimer = undefined;
    this.#matcherGeneration += 1;
    this.#annotationGeneration += 1;
    this.#backgroundGeneration += 1;
    this.#abortProviderRequests();
    this.#pendingSemantics.splice(0);
    if (!visible) {
      disposeAll(this.#matcherDecorations);
      this.#clearAnnotations();
      this.#renderBackground([]);
    }
    if (visible && this.#active) {
      void this.refreshBackground('terminal-visible', terminalBackground ?? this.#terminalBackground);
      this.#scheduleMatcherRefresh();
    }
  }

  providerAvailabilityChanged(terminalBackground?: string): void {
    if (this.#disposed) return;
    this.#providerAvailabilityGeneration += 1;
    this.#matcherGeneration += 1;
    this.#annotationGeneration += 1;
    this.#backgroundGeneration += 1;
    this.#abortProviderRequests();
    this.#pendingSemantics.splice(0);
    this.#clearAnnotations();
    if (!this.#isProviderAvailable('terminal.background')) this.#renderBackground([]);
    if (!this.#isProviderAvailable('terminal.matcher')) disposeAll(this.#matcherDecorations);
    if (this.#active && this.#visible) {
      void this.refreshBackground('providers-changed', terminalBackground ?? this.#terminalBackground);
      this.#scheduleMatcherRefresh();
    }
  }

  #renderBackground(layers: readonly { color: string; opacity: number }[]): void {
    this.#backgroundOverlay?.remove();
    this.#backgroundOverlay = null;
    const root = this.#term.element;
    if (!root || layers.length === 0 || this.#disposed || !this.#active || !this.#visible) return;
    const overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.className = 'pointer-events-none absolute inset-0 z-[1]';
    const totalOpacity = layers.reduce((total, layer) => total + layer.opacity, 0);
    const opacityScale = totalOpacity > 0.35 ? 0.35 / totalOpacity : 1;
    overlay.style.background = layers
      .map((layer) => {
        const red = Number.parseInt(layer.color.slice(1, 3), 16);
        const green = Number.parseInt(layer.color.slice(3, 5), 16);
        const blue = Number.parseInt(layer.color.slice(5, 7), 16);
        const colorAlpha = layer.color.length === 9
          ? Number.parseInt(layer.color.slice(7, 9), 16) / 255
          : 1;
        const alpha = layer.opacity * opacityScale * colorAlpha;
        const rgba = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
        return `linear-gradient(${rgba}, ${rgba})`;
      })
      .join(', ');
    root.appendChild(overlay);
    this.#backgroundOverlay = overlay;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    clearTimeout(this.#matcherTimer);
    clearTimeout(this.#backgroundTimer);
    this.#matcherGeneration += 1;
    this.#annotationGeneration += 1;
    this.#backgroundGeneration += 1;
    this.#abortProviderRequests();
    this.#pendingSemantics.splice(0);
    disposeAll(this.#matcherDecorations);
    this.#clearAnnotations();
    this.#backgroundOverlay?.remove();
    this.#backgroundOverlay = null;
    disposeAll(this.#disposables);
  }
}
