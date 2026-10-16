import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCustomAccentRecord,
  serializeCustomAccentRecord,
  shouldApplyCustomAccentRecord,
  shouldBroadcastCustomAccentChange,
  type CustomAccentMutationSource,
  type CustomAccentRecord,
} from './customAccentSync.ts';

/**
 * Minimal model of the settings ↔ main custom-accent sync loop that caused
 * #2743. Models both IPC rebroadcast and stale localStorage overwrites while
 * the native color picker fires rapid onChange events.
 */
function simulateAccentDrag(options: {
  shouldBroadcast: (
    source: CustomAccentMutationSource,
    persistMounted: boolean,
  ) => { shouldBroadcast: boolean; nextSource: CustomAccentMutationSource };
  shouldApply: (current: CustomAccentRecord, incoming: CustomAccentRecord) => boolean;
  versioned: boolean;
}): { settingsValues: string[]; mainValues: string[]; storageWrites: string[] } {
  let settings: CustomAccentRecord = { color: '221.2 83.2% 53.3%', version: 0 };
  let main: CustomAccentRecord = { color: '221.2 83.2% 53.3%', version: 0 };
  let settingsSource: CustomAccentMutationSource = 'local';
  let mainSource: CustomAccentMutationSource = 'local';
  let storage = options.versioned
    ? serializeCustomAccentRecord(settings)
    : settings.color;
  const settingsValues: string[] = [];
  const mainValues: string[] = [];
  const storageWrites: string[] = [];

  const pendingIpc: Array<{ to: 'settings' | 'main'; record: CustomAccentRecord }> = [];

  const writeStorage = (record: CustomAccentRecord) => {
    const next = options.versioned
      ? serializeCustomAccentRecord(record)
      : record.color;
    if (next === storage) return;
    storage = next;
    storageWrites.push(next);
  };

  const applyLocal = (window: 'settings' | 'main', color: string) => {
    const bump = (prev: CustomAccentRecord): CustomAccentRecord => (
      options.versioned
        ? { color, version: prev.version + 1 }
        : { color, version: 0 }
    );

    if (window === 'settings') {
      settingsSource = 'local';
      settings = bump(settings);
      settingsValues.push(settings.color);
      writeStorage(settings);
      const decision = options.shouldBroadcast(settingsSource, true);
      settingsSource = decision.nextSource;
      if (decision.shouldBroadcast) pendingIpc.push({ to: 'main', record: { ...settings } });
      return;
    }

    mainSource = 'local';
    main = bump(main);
    mainValues.push(main.color);
    writeStorage(main);
    const decision = options.shouldBroadcast(mainSource, true);
    mainSource = decision.nextSource;
    if (decision.shouldBroadcast) pendingIpc.push({ to: 'settings', record: { ...main } });
  };

  const applyIncoming = (window: 'settings' | 'main', record: CustomAccentRecord) => {
    if (window === 'settings') {
      if (!options.shouldApply(settings, record)) return;
      settingsSource = 'incoming';
      settings = { ...record };
      settingsValues.push(settings.color);
      writeStorage(settings);
      const decision = options.shouldBroadcast(settingsSource, true);
      settingsSource = decision.nextSource;
      if (decision.shouldBroadcast) pendingIpc.push({ to: 'main', record: { ...settings } });
      return;
    }

    if (!options.shouldApply(main, record)) return;
    mainSource = 'incoming';
    main = { ...record };
    mainValues.push(main.color);
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
    const record = options.versioned
      ? parseCustomAccentRecord(JSON.parse(storage))
      : parseCustomAccentRecord(storage);
    applyIncoming(window, record);
  };

  applyLocal('settings', '0 84% 60%');
  deliverStorageTo('main');
  applyLocal('settings', '199 89% 48%');
  // Delayed IPC for the older color arrives after the newer local drag sample.
  const delayed = pendingIpc.shift();
  flushIpc();
  if (delayed) applyIncoming(delayed.to, delayed.record);
  deliverStorageTo('settings');
  flushIpc();

  return { settingsValues, mainValues, storageWrites };
}

test('parseCustomAccentRecord accepts legacy HSL tokens and versioned JSON', () => {
  assert.deepEqual(parseCustomAccentRecord('199 89% 48%'), { color: '199 89% 48%', version: 0 });
  assert.deepEqual(
    parseCustomAccentRecord({ color: '0 84% 60%', version: 3 }),
    { color: '0 84% 60%', version: 3 },
  );
  assert.deepEqual(
    parseCustomAccentRecord('{"color":"262.1 83.3% 57.8%","version":9}'),
    { color: '262.1 83.3% 57.8%', version: 9 },
  );
  assert.equal(parseCustomAccentRecord('bad').color, '221.2 83.2% 53.3%');
});

test('shouldApplyCustomAccentRecord ignores stale revisions', () => {
  const current = { color: '199 89% 48%', version: 2 };
  assert.equal(shouldApplyCustomAccentRecord(current, { color: '0 84% 60%', version: 1 }), false);
  assert.equal(shouldApplyCustomAccentRecord(current, { color: '330 81% 60%', version: 3 }), true);
  assert.equal(shouldApplyCustomAccentRecord(current, { color: '199 89% 48%', version: 2 }), false);
});

test('shouldBroadcastCustomAccentChange suppresses incoming rebroadcasts', () => {
  assert.deepEqual(
    shouldBroadcastCustomAccentChange('incoming', true),
    { shouldBroadcast: false, nextSource: 'local' },
  );
  assert.deepEqual(
    shouldBroadcastCustomAccentChange('local', true),
    { shouldBroadcast: true, nextSource: 'local' },
  );
  assert.deepEqual(
    shouldBroadcastCustomAccentChange('local', false),
    { shouldBroadcast: false, nextSource: 'local' },
  );
});

test('legacy unversioned always-broadcast accent sync oscillates during a fast drag', () => {
  const alwaysBroadcast = (
    _source: CustomAccentMutationSource,
    persistMounted: boolean,
  ) => ({
    shouldBroadcast: persistMounted,
    nextSource: 'local' as const,
  });
  const alwaysApply = () => true;

  const { settingsValues } = simulateAccentDrag({
    shouldBroadcast: alwaysBroadcast,
    shouldApply: alwaysApply,
    versioned: false,
  });
  const unique = new Set(settingsValues);
  assert.ok(
    unique.has('0 84% 60%') && unique.has('199 89% 48%') && settingsValues.length > 2,
    `expected oscillation between drag samples, got ${settingsValues.join(' | ')}`,
  );
});

test('versioned accent sync ignores stale peer echoes during a fast drag', () => {
  const { settingsValues, mainValues } = simulateAccentDrag({
    shouldBroadcast: shouldBroadcastCustomAccentChange,
    shouldApply: shouldApplyCustomAccentRecord,
    versioned: true,
  });

  assert.deepEqual(settingsValues, ['0 84% 60%', '199 89% 48%']);
  assert.ok(mainValues.includes('199 89% 48%'));
  assert.equal(
    mainValues.includes('0 84% 60%') && mainValues[mainValues.length - 1] === '0 84% 60%',
    false,
  );
});

test('serializeCustomAccentRecord round-trips through parse', () => {
  const raw = serializeCustomAccentRecord({ color: '262.1 83.3% 57.8%', version: 9 });
  assert.deepEqual(parseCustomAccentRecord(JSON.parse(raw)), {
    color: '262.1 83.3% 57.8%',
    version: 9,
  });
});
