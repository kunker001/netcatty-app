import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from '../../infrastructure/config/fonts';

export type TerminalFontSizeMutationSource = 'local' | 'incoming';

export type TerminalFontSizeRecord = {
  fontSize: number;
  version: number;
  origin: string;
};

const LEGACY_TERMINAL_FONT_SIZE_ORIGIN = 'legacy';

function normalizeTerminalFontSizeOrigin(origin: unknown): string {
  return typeof origin === 'string' && origin.length > 0
    ? origin
    : LEGACY_TERMINAL_FONT_SIZE_ORIGIN;
}

export function clampTerminalFontSizeValue(fontSize: unknown): number {
  const value = typeof fontSize === 'number' ? fontSize : Number(fontSize);
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(value)));
}

/**
 * Parse persisted / IPC terminal-font-size payloads.
 * Accepts legacy plain numbers ("16") and versioned records.
 */
export function parseTerminalFontSizeRecord(raw: unknown): TerminalFontSizeRecord {
  if (typeof raw === 'number' || typeof raw === 'string') {
    const trimmed = typeof raw === 'string' ? raw.trim() : raw;
    if (typeof trimmed === 'string' && trimmed.startsWith('{')) {
      try {
        return parseTerminalFontSizeRecord(JSON.parse(trimmed));
      } catch {
        // fall through to Number()
      }
    }
    if (typeof trimmed === 'string') {
      const [fontSizePart, versionPart, encodedOrigin, ...rest] = trimmed.split('|');
      if (encodedOrigin && rest.length === 0) {
        const fontSize = Number(fontSizePart);
        const version = Number(versionPart);
        if (Number.isFinite(fontSize) && Number.isFinite(version)) {
          let origin = encodedOrigin;
          try {
            origin = decodeURIComponent(encodedOrigin);
          } catch {
            // Keep the encoded value as a stable tie-breaker.
          }
          return {
            fontSize: clampTerminalFontSizeValue(fontSize),
            version: version > 0 ? Math.floor(version) : 0,
            origin: normalizeTerminalFontSizeOrigin(origin),
          };
        }
      }
    }
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return {
        fontSize: clampTerminalFontSizeValue(asNumber),
        version: 0,
        origin: LEGACY_TERMINAL_FONT_SIZE_ORIGIN,
      };
    }
  }

  if (raw && typeof raw === 'object') {
    const record = raw as { fontSize?: unknown; version?: unknown; origin?: unknown };
    const fontSize = clampTerminalFontSizeValue(record.fontSize);
    const version = Number(record.version);
    return {
      fontSize,
      version: Number.isFinite(version) && version > 0 ? Math.floor(version) : 0,
      origin: normalizeTerminalFontSizeOrigin(record.origin),
    };
  }

  return {
    fontSize: DEFAULT_FONT_SIZE,
    version: 0,
    origin: LEGACY_TERMINAL_FONT_SIZE_ORIGIN,
  };
}

export function serializeTerminalFontSizeRecord(record: TerminalFontSizeRecord): string {
  const fontSize = clampTerminalFontSizeValue(record.fontSize);
  const version = Math.max(0, Math.floor(record.version) || 0);
  const origin = encodeURIComponent(normalizeTerminalFontSizeOrigin(record.origin));
  // Keep the font size first so older Netcatty versions using parseInt() can
  // still read the preference after a downgrade.
  return `${fontSize}|${version}|${origin}`;
}

export function createTerminalFontSizeSyncOrigin(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function nextTerminalFontSizeSyncVersion(
  currentVersion: number,
  persistedVersion: number,
  now: number = Date.now(),
): number {
  return Math.max(
    Math.floor(now),
    Math.floor(currentVersion) + 1,
    Math.floor(persistedVersion) + 1,
  );
}

export function createLocalTerminalFontSizeRecord(
  current: TerminalFontSizeRecord,
  persistedRaw: unknown,
  nextFontSizeValue: unknown,
  origin: string,
  now: number = Date.now(),
): TerminalFontSizeRecord {
  const nextFontSize = clampTerminalFontSizeValue(nextFontSizeValue);
  if (nextFontSize === current.fontSize) return current;
  const persisted = parseTerminalFontSizeRecord(persistedRaw);
  return {
    fontSize: nextFontSize,
    version: nextTerminalFontSizeSyncVersion(current.version, persisted.version, now),
    origin: normalizeTerminalFontSizeOrigin(origin),
  };
}

export function areTerminalFontSizeRecordsEqual(
  left: TerminalFontSizeRecord,
  right: TerminalFontSizeRecord,
): boolean {
  return left.fontSize === right.fontSize
    && left.version === right.version
    && left.origin === right.origin;
}

/**
 * Incoming peer updates must not clobber a newer local revision. A stable
 * origin tie-break makes simultaneous writers converge on the same record.
 */
export function shouldApplyTerminalFontSizeRecord(
  current: TerminalFontSizeRecord,
  incoming: TerminalFontSizeRecord,
): boolean {
  if (incoming.version > current.version) return true;
  if (incoming.version < current.version) return false;
  if (
    incoming.version === 0
    && incoming.origin === LEGACY_TERMINAL_FONT_SIZE_ORIGIN
    && current.origin === LEGACY_TERMINAL_FONT_SIZE_ORIGIN
  ) {
    return incoming.fontSize !== current.fontSize;
  }
  if (incoming.origin !== current.origin) return incoming.origin > current.origin;
  return incoming.fontSize > current.fontSize;
}

export type TerminalFontSizeStorageResolution = {
  record: TerminalFontSizeRecord;
  serializedRecord: string;
  shouldAdopt: boolean;
  shouldPersist: boolean;
};

export type TerminalFontSizeIncomingResolution = {
  record: TerminalFontSizeRecord;
  shouldUpdate: boolean;
  repairSerializedRecord: string | null;
};

export function resolveTerminalFontSizeStorage(
  current: TerminalFontSizeRecord,
  storedRaw: unknown,
): TerminalFontSizeStorageResolution {
  const stored = parseTerminalFontSizeRecord(storedRaw);
  if (shouldApplyTerminalFontSizeRecord(current, stored)) {
    return {
      record: stored,
      serializedRecord: serializeTerminalFontSizeRecord(stored),
      shouldAdopt: true,
      shouldPersist: false,
    };
  }

  const serializedRecord = serializeTerminalFontSizeRecord(current);
  return {
    record: current,
    serializedRecord,
    shouldAdopt: false,
    shouldPersist: storedRaw !== serializedRecord,
  };
}

export function resolveAuthoritativeTerminalFontSizeStorage(
  currentRef: Readonly<{ current: TerminalFontSizeRecord }>,
  storedRaw: unknown,
): TerminalFontSizeStorageResolution {
  return resolveTerminalFontSizeStorage(currentRef.current, storedRaw);
}

export function resolveIncomingTerminalFontSize(
  current: TerminalFontSizeRecord,
  incomingRaw: unknown,
  storedRaw: unknown,
): TerminalFontSizeIncomingResolution {
  const incoming = parseTerminalFontSizeRecord(incomingRaw);
  if (shouldApplyTerminalFontSizeRecord(current, incoming)) {
    return {
      record: incoming,
      shouldUpdate: true,
      repairSerializedRecord: null,
    };
  }

  const storageResolution = resolveTerminalFontSizeStorage(current, storedRaw);
  if (storageResolution.shouldAdopt) {
    return {
      record: storageResolution.record,
      shouldUpdate: true,
      repairSerializedRecord: null,
    };
  }

  return {
    record: current,
    shouldUpdate: false,
    repairSerializedRecord: storageResolution.shouldPersist
      ? storageResolution.serializedRecord
      : null,
  };
}

/**
 * Decide whether a terminal-font-size state change should be rebroadcast to
 * peer windows. Incoming IPC/storage updates must not notify again —
 * otherwise +/- clicks in the Settings window ping-pong with the main window
 * and terminals oscillate between the last two sizes (see #2689, same class
 * as window-opacity #2018).
 */
export function shouldBroadcastTerminalFontSizeChange(
  mutationSource: TerminalFontSizeMutationSource,
  persistMounted: boolean,
): { shouldBroadcast: boolean; nextSource: TerminalFontSizeMutationSource } {
  if (mutationSource === 'incoming') {
    return { shouldBroadcast: false, nextSource: 'local' };
  }
  return { shouldBroadcast: persistMounted, nextSource: 'local' };
}
