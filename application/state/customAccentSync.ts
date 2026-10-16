import { DEFAULT_CUSTOM_ACCENT, isValidHslToken } from './settingsStateDefaults';

export type CustomAccentMutationSource = 'local' | 'incoming';

export type CustomAccentRecord = {
  color: string;
  version: number;
};

const FALLBACK_RECORD: CustomAccentRecord = {
  color: DEFAULT_CUSTOM_ACCENT,
  version: 0,
};

function normalizeAccentColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return isValidHslToken(trimmed) ? trimmed : null;
}

/**
 * Parse persisted / IPC custom-accent payloads.
 * Accepts legacy plain HSL tokens ("221.2 83.2% 53.3%") and versioned records.
 */
export function parseCustomAccentRecord(raw: unknown): CustomAccentRecord {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        return parseCustomAccentRecord(JSON.parse(trimmed));
      } catch {
        // fall through to plain HSL
      }
    }
    const color = normalizeAccentColor(trimmed);
    if (color) return { color, version: 0 };
  }

  if (raw && typeof raw === 'object') {
    const record = raw as { color?: unknown; version?: unknown };
    const color = normalizeAccentColor(record.color) ?? FALLBACK_RECORD.color;
    const version = Number(record.version);
    return {
      color,
      version: Number.isFinite(version) && version > 0 ? Math.floor(version) : 0,
    };
  }

  return { ...FALLBACK_RECORD };
}

export function serializeCustomAccentRecord(record: CustomAccentRecord): string {
  const color = normalizeAccentColor(record.color) ?? FALLBACK_RECORD.color;
  return JSON.stringify({
    color,
    version: Math.max(0, Math.floor(record.version) || 0),
  });
}

/**
 * Incoming peer updates must not clobber a newer local/drag revision.
 * Equal versions are treated as already-applied (no state thrash).
 */
export function shouldApplyCustomAccentRecord(
  current: CustomAccentRecord,
  incoming: CustomAccentRecord,
): boolean {
  if (incoming.version > current.version) return true;
  if (incoming.version < current.version) return false;
  // Same version: only apply when the color itself differs and both are
  // legacy/unversioned (version 0), so first-load plain strings still sync.
  if (incoming.version === 0 && current.version === 0) {
    return incoming.color !== current.color;
  }
  return false;
}

/**
 * Decide whether a custom-accent state change should be rebroadcast to peer
 * windows. Incoming IPC/storage updates must not notify again - otherwise a
 * fast native color-picker drag in the settings window ping-pongs with the
 * main window and the accent CSS variables oscillate (see #2743, same class
 * as window-opacity #2018).
 */
export function shouldBroadcastCustomAccentChange(
  mutationSource: CustomAccentMutationSource,
  persistMounted: boolean,
): { shouldBroadcast: boolean; nextSource: CustomAccentMutationSource } {
  if (mutationSource === 'incoming') {
    return { shouldBroadcast: false, nextSource: 'local' };
  }
  return { shouldBroadcast: persistMounted, nextSource: 'local' };
}
