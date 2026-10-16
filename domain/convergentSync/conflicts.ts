import { dotKey } from './clock';
import { applyConvergentMutations } from './state';
import type {
  ConvergentConflictAddress,
  ConvergentConflictCandidate,
  ConvergentFieldConflict,
  ConvergentSyncStateV2,
  JsonValue,
  RegisterAddress,
} from './types';

export function convergentConflictAddressKey(address: ConvergentConflictAddress): string {
  switch (address.kind) {
    case 'entity-presence':
    case 'entity-position':
      return JSON.stringify([address.kind, address.collection, address.entityId]);
    case 'entity-field':
      return JSON.stringify([address.kind, address.collection, address.entityId, address.field]);
    case 'setting':
      return JSON.stringify([address.kind, ...address.path]);
    case 'setting-structure':
      return JSON.stringify([address.kind, ...address.paths]);
    case 'string-entry-presence':
    case 'string-entry-position':
      return JSON.stringify([address.kind, address.collection, address.value]);
  }
}

function selectedAddress(
  conflict: ConvergentFieldConflict,
  candidate: ConvergentConflictCandidate,
): RegisterAddress {
  if (conflict.address.kind !== 'setting-structure') return conflict.address;
  if (!candidate.settingPath?.length) {
    throw new Error('A setting-structure candidate must identify its setting path');
  }
  return { kind: 'setting', path: candidate.settingPath };
}

export function resolveConvergentFieldConflict(
  state: ConvergentSyncStateV2,
  conflict: ConvergentFieldConflict,
  candidateDot: string,
  deviceId: string,
  now: number,
): ConvergentSyncStateV2 {
  const candidate = conflict.candidates.find((entry) => dotKey(entry.dot) === candidateDot);
  if (!candidate) throw new Error('The selected convergent conflict candidate no longer exists');
  if (!candidate.tombstone && candidate.value === undefined) {
    throw new Error('The selected convergent conflict candidate has no value');
  }
  return applyConvergentMutations(state, deviceId, [{
    kind: 'resolve-register',
    address: selectedAddress(conflict, candidate),
    ...(candidate.tombstone ? { tombstone: true } : { value: candidate.value }),
  }], now);
}

const SECRET_SEGMENT = /(?:password|passphrase|privatekey|secret|token|api[_-]?key|access[_-]?key)/i;

function valueContainsSecretField(value: JsonValue | undefined): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((nested) => valueContainsSecretField(nested));
  return Object.entries(value).some(([key, nested]) =>
    SECRET_SEGMENT.test(key) || valueContainsSecretField(nested));
}

/** Values from secret-bearing registers must never be rendered or logged. */
export function isConvergentConflictSecret(conflict: ConvergentFieldConflict): boolean {
  const { address } = conflict;
  if (address.kind === 'entity-field' && SECRET_SEGMENT.test(address.field)) return true;
  if (address.kind === 'setting' && address.path.some((segment) => SECRET_SEGMENT.test(segment))) {
    return true;
  }
  if (
    address.kind === 'setting-structure'
    && address.paths.some((path) => path.some((segment) => SECRET_SEGMENT.test(segment)))
  ) return true;
  return conflict.candidates.some((candidate) => valueContainsSecretField(candidate.value));
}
