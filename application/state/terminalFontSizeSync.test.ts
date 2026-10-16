import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLocalTerminalFontSizeRecord,
  parseTerminalFontSizeRecord,
  resolveAuthoritativeTerminalFontSizeStorage,
  resolveIncomingTerminalFontSize,
  resolveTerminalFontSizeStorage,
  serializeTerminalFontSizeRecord,
  shouldApplyTerminalFontSizeRecord,
  shouldBroadcastTerminalFontSizeChange,
  type TerminalFontSizeMutationSource,
  type TerminalFontSizeRecord,
} from './terminalFontSizeSync.ts';

/**
 * Minimal model of the settings ↔ main font-size sync loop that caused #2689.
 * Models both IPC rebroadcast and stale localStorage overwrites.
 */
function simulateFontSizeClicks(options: {
  shouldBroadcast: (
    source: TerminalFontSizeMutationSource,
    persistMounted: boolean,
  ) => { shouldBroadcast: boolean; nextSource: TerminalFontSizeMutationSource };
  shouldApply: (current: TerminalFontSizeRecord, incoming: TerminalFontSizeRecord) => boolean;
  versioned: boolean;
}): { settingsValues: number[]; mainValues: number[]; storageWrites: string[] } {
  let settings: TerminalFontSizeRecord = { fontSize: 16, version: 0, origin: 'legacy' };
  let main: TerminalFontSizeRecord = { fontSize: 16, version: 0, origin: 'legacy' };
  let settingsSource: TerminalFontSizeMutationSource = 'local';
  let mainSource: TerminalFontSizeMutationSource = 'local';
  let storage = options.versioned
    ? serializeTerminalFontSizeRecord(settings)
    : String(settings.fontSize);
  const settingsValues: number[] = [];
  const mainValues: number[] = [];
  const storageWrites: string[] = [];

  const pendingIpc: Array<{ to: 'settings' | 'main'; record: TerminalFontSizeRecord }> = [];

  const writeStorage = (record: TerminalFontSizeRecord) => {
    const next = options.versioned
      ? serializeTerminalFontSizeRecord(record)
      : String(record.fontSize);
    if (next === storage) return;
    storage = next;
    storageWrites.push(next);
  };

  const applyLocal = (window: 'settings' | 'main', fontSize: number) => {
    const bump = (
      prev: TerminalFontSizeRecord,
      origin: string,
    ): TerminalFontSizeRecord => (
      options.versioned
        ? { fontSize, version: prev.version + 1, origin }
        : { fontSize, version: 0, origin: 'legacy' }
    );

    if (window === 'settings') {
      settingsSource = 'local';
      settings = bump(settings, 'settings-window');
      settingsValues.push(settings.fontSize);
      writeStorage(settings);
      const decision = options.shouldBroadcast(settingsSource, true);
      settingsSource = decision.nextSource;
      if (decision.shouldBroadcast) pendingIpc.push({ to: 'main', record: { ...settings } });
      return;
    }

    mainSource = 'local';
    main = bump(main, 'main-window');
    mainValues.push(main.fontSize);
    writeStorage(main);
    const decision = options.shouldBroadcast(mainSource, true);
    mainSource = decision.nextSource;
    if (decision.shouldBroadcast) pendingIpc.push({ to: 'settings', record: { ...main } });
  };

  const applyIncoming = (window: 'settings' | 'main', record: TerminalFontSizeRecord) => {
    if (window === 'settings') {
      if (!options.shouldApply(settings, record)) return;
      settingsSource = 'incoming';
      settings = { ...record };
      settingsValues.push(settings.fontSize);
      writeStorage(settings);
      const decision = options.shouldBroadcast(settingsSource, true);
      settingsSource = decision.nextSource;
      if (decision.shouldBroadcast) pendingIpc.push({ to: 'main', record: { ...settings } });
      return;
    }

    if (!options.shouldApply(main, record)) return;
    mainSource = 'incoming';
    main = { ...record };
    mainValues.push(main.fontSize);
    writeStorage(main);
    const decision = options.shouldBroadcast(mainSource, true);
    mainSource = decision.nextSource;
    if (decision.shouldBroadcast) pendingIpc.push({ to: 'settings', record: { ...main } });
  };

  const flushIpc = () => {
    while (pendingIpc.length > 0) {
      const next = pendingIpc.shift()!;
      applyIncoming(next.to, next.record);
      if (settingsValues.length > 40) break;
    }
  };

  const deliverStorageTo = (window: 'settings' | 'main') => {
    const record = parseTerminalFontSizeRecord(storage);
    applyIncoming(window, record);
  };

  // Match reporter steps: + (16→17) then - while a delayed peer echo of 17
  // can still race with a later local 15.
  applyLocal('settings', 17);
  deliverStorageTo('main');
  applyLocal('settings', 15);
  const delayed = pendingIpc.shift();
  flushIpc();
  if (delayed) applyIncoming(delayed.to, delayed.record);
  deliverStorageTo('settings');
  flushIpc();

  return { settingsValues, mainValues, storageWrites };
}

test('parseTerminalFontSizeRecord accepts legacy plain numbers and versioned records', () => {
  assert.deepEqual(
    parseTerminalFontSizeRecord('16'),
    { fontSize: 16, version: 0, origin: 'legacy' },
  );
  assert.deepEqual(
    parseTerminalFontSizeRecord(14),
    { fontSize: 14, version: 0, origin: 'legacy' },
  );
  assert.deepEqual(
    parseTerminalFontSizeRecord({ fontSize: 18, version: 3, origin: 'window-a' }),
    { fontSize: 18, version: 3, origin: 'window-a' },
  );
  assert.deepEqual(
    parseTerminalFontSizeRecord('{"fontSize":15,"version":9,"origin":"window-b"}'),
    { fontSize: 15, version: 9, origin: 'window-b' },
  );
  assert.deepEqual(
    parseTerminalFontSizeRecord('17|12|settings-window'),
    { fontSize: 17, version: 12, origin: 'settings-window' },
  );
  assert.equal(parseTerminalFontSizeRecord('bad').fontSize, 14);
});

test('shouldApplyTerminalFontSizeRecord ignores stale revisions', () => {
  const current = { fontSize: 15, version: 2, origin: 'window-a' };
  assert.equal(
    shouldApplyTerminalFontSizeRecord(
      current,
      { fontSize: 17, version: 1, origin: 'window-b' },
    ),
    false,
  );
  assert.equal(
    shouldApplyTerminalFontSizeRecord(
      current,
      { fontSize: 18, version: 3, origin: 'window-b' },
    ),
    true,
  );
  assert.equal(shouldApplyTerminalFontSizeRecord(current, { ...current }), false);
});

test('simultaneous writers converge through storage in either persistence order', () => {
  const run = (order: Array<'settings' | 'main'>) => {
    const initial: TerminalFontSizeRecord = {
      fontSize: 16,
      version: 1,
      origin: 'initial-window',
    };
    let storage = serializeTerminalFontSizeRecord(initial);
    let settings = createLocalTerminalFontSizeRecord(
      initial,
      storage,
      17,
      'settings-window',
      10,
    );
    let main = createLocalTerminalFontSizeRecord(
      initial,
      storage,
      15,
      'main-window',
      10,
    );

    for (const writer of order) {
      const current = writer === 'settings' ? settings : main;
      const resolution = resolveTerminalFontSizeStorage(current, storage);
      if (resolution.shouldAdopt) {
        if (writer === 'settings') settings = resolution.record;
        else main = resolution.record;
      } else if (resolution.shouldPersist) {
        storage = resolution.serializedRecord;
      }
    }

    const settingsResolution = resolveTerminalFontSizeStorage(settings, storage);
    const mainResolution = resolveTerminalFontSizeStorage(main, storage);
    settings = settingsResolution.record;
    main = mainResolution.record;

    assert.equal(settingsResolution.shouldPersist, false);
    assert.equal(mainResolution.shouldPersist, false);
    assert.deepEqual(settings, main);
    assert.equal(resolveTerminalFontSizeStorage(settings, storage).shouldAdopt, false);
    assert.equal(resolveTerminalFontSizeStorage(settings, storage).shouldPersist, false);
    return settings;
  };

  assert.deepEqual(run(['settings', 'main']), run(['main', 'settings']));
});

test('a stale window creates and persists a revision newer than shared storage', () => {
  const stored = serializeTerminalFontSizeRecord({
    fontSize: 18,
    version: 7,
    origin: 'main-window',
  });
  const local = createLocalTerminalFontSizeRecord(
    { fontSize: 15, version: 2, origin: 'settings-window' },
    stored,
    16,
    'settings-window',
    5,
  );
  assert.equal(local.version, 8);
  const resolution = resolveTerminalFontSizeStorage(local, stored);
  assert.equal(resolution.shouldAdopt, false);
  assert.equal(resolution.shouldPersist, true);
  assert.deepEqual(parseTerminalFontSizeRecord(resolution.serializedRecord), local);
});

test('a rejected losing record repairs shared storage back to the current winner', () => {
  const winner: TerminalFontSizeRecord = {
    fontSize: 17,
    version: 10,
    origin: 'settings-window',
  };
  const loser: TerminalFontSizeRecord = {
    fontSize: 15,
    version: 10,
    origin: 'main-window',
  };
  const loserRaw = serializeTerminalFontSizeRecord(loser);

  const rejected = resolveIncomingTerminalFontSize(winner, loser, loserRaw);
  assert.equal(rejected.shouldUpdate, false);
  assert.deepEqual(rejected.record, winner);
  assert.equal(
    rejected.repairSerializedRecord,
    serializeTerminalFontSizeRecord(winner),
  );

  const stable = resolveIncomingTerminalFontSize(
    winner,
    loser,
    rejected.repairSerializedRecord,
  );
  assert.equal(stable.shouldUpdate, false);
  assert.equal(stable.repairSerializedRecord, null);
});

test('a delayed persistence effect arbitrates from the latest authoritative record', () => {
  const renderedWhenEffectWasScheduled: TerminalFontSizeRecord = {
    fontSize: 14,
    version: 9,
    origin: 'old-window',
  };
  const winner: TerminalFontSizeRecord = {
    fontSize: 17,
    version: 10,
    origin: 'settings-window',
  };
  const loser: TerminalFontSizeRecord = {
    fontSize: 15,
    version: 10,
    origin: 'main-window',
  };
  const currentRef = { current: renderedWhenEffectWasScheduled };
  currentRef.current = winner;

  const resolution = resolveAuthoritativeTerminalFontSizeStorage(
    currentRef,
    serializeTerminalFontSizeRecord(loser),
  );
  assert.equal(resolution.shouldAdopt, false);
  assert.equal(resolution.shouldPersist, true);
  assert.deepEqual(resolution.record, winner);
  assert.deepEqual(parseTerminalFontSizeRecord(resolution.serializedRecord), winner);
});

test('shouldBroadcastTerminalFontSizeChange suppresses incoming rebroadcasts', () => {
  assert.deepEqual(
    shouldBroadcastTerminalFontSizeChange('incoming', true),
    { shouldBroadcast: false, nextSource: 'local' },
  );
  assert.deepEqual(
    shouldBroadcastTerminalFontSizeChange('local', true),
    { shouldBroadcast: true, nextSource: 'local' },
  );
  assert.deepEqual(
    shouldBroadcastTerminalFontSizeChange('local', false),
    { shouldBroadcast: false, nextSource: 'local' },
  );
});

test('legacy unversioned always-broadcast font size sync oscillates during rapid +/- clicks', () => {
  const alwaysBroadcast = (
    _source: TerminalFontSizeMutationSource,
    persistMounted: boolean,
  ) => ({
    shouldBroadcast: persistMounted,
    nextSource: 'local' as const,
  });
  const alwaysApply = () => true;

  const { settingsValues } = simulateFontSizeClicks({
    shouldBroadcast: alwaysBroadcast,
    shouldApply: alwaysApply,
    versioned: false,
  });
  const unique = new Set(settingsValues);
  assert.ok(
    unique.has(17) && unique.has(15) && settingsValues.length > 2,
    `expected oscillation between 17 and 15, got ${settingsValues.join(',')}`,
  );
});

test('versioned font size sync ignores stale peer echoes during rapid +/- clicks', () => {
  const { settingsValues, mainValues } = simulateFontSizeClicks({
    shouldBroadcast: shouldBroadcastTerminalFontSizeChange,
    shouldApply: shouldApplyTerminalFontSizeRecord,
    versioned: true,
  });

  assert.deepEqual(settingsValues, [17, 15]);
  assert.ok(mainValues.includes(15));
  assert.equal(mainValues.includes(17) && mainValues[mainValues.length - 1] === 17, false);
});

test('serializeTerminalFontSizeRecord round-trips through parse', () => {
  const record = { fontSize: 18, version: 9, origin: 'window|with delimiter' };
  const raw = serializeTerminalFontSizeRecord(record);
  assert.deepEqual(parseTerminalFontSizeRecord(raw), record);
});

test('serialized records remain readable by the old parseInt storage reader', () => {
  const raw = serializeTerminalFontSizeRecord({
    fontSize: 18,
    version: 9,
    origin: 'settings-window',
  });
  assert.equal(parseInt(raw, 10), 18);
});
