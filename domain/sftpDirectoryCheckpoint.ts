import type { DirectoryResumeCheckpoint } from "./models";

export const EMPTY_DIRECTORY_MANIFEST_HASH = "0".repeat(64);
export const DIRECTORY_RESUME_CHECKPOINT_VERSION = 2;
export const EMPTY_DIRECTORY_MANIFEST_STATE_V2 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
].map((word) => word.toString(16).padStart(8, "0")).join("");
export const MAX_SFTP_FOLLOWED_SYMLINK_DEPTH = 32;
export const MAX_SFTP_DIRECTORY_TRAVERSAL_DIRECTORIES = 50_000;
export const MAX_SFTP_DIRECTORY_TRAVERSAL_ENTRIES = 200_000;

export interface SftpDirectoryTraversalBudget {
  /**
   * Default branch ancestor set for sequential callers. Parallel walks must
   * pass a per-branch Set into claim/release instead of sharing this one.
   */
  activeCanonicalDirectories: Set<string>;
  visitedDirectories: number;
  visitedEntries: number;
  maxDirectories: number;
  maxEntries: number;
}

export function createSftpDirectoryTraversalBudget(limits: {
  maxDirectories?: number;
  maxEntries?: number;
} = {}): SftpDirectoryTraversalBudget {
  return {
    activeCanonicalDirectories: new Set(),
    visitedDirectories: 0,
    visitedEntries: 0,
    maxDirectories: limits.maxDirectories ?? MAX_SFTP_DIRECTORY_TRAVERSAL_DIRECTORIES,
    maxEntries: limits.maxEntries ?? MAX_SFTP_DIRECTORY_TRAVERSAL_ENTRIES,
  };
}

export function normalizeSftpCanonicalDirectoryPath(canonicalPath: string): string {
  return canonicalPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

/** Copy parent ancestors for a parallel recursive branch (sibling aliases). */
export function createSftpDirectoryBranchAncestors(
  parent?: ReadonlySet<string> | null,
): Set<string> {
  return parent ? new Set(parent) : new Set();
}

/**
 * Claims one directory against the global work budget. Cycle detection uses
 * `branchAncestors` (defaults to the budget's sequential set). Parallel sibling
 * walks must each pass their own branch set so two aliases of the same
 * canonical path can both be copied.
 */
export function claimSftpDirectoryVisit(
  budget: SftpDirectoryTraversalBudget,
  canonicalPath: string,
  branchAncestors: Set<string> = budget.activeCanonicalDirectories,
): string | null {
  const normalized = normalizeSftpCanonicalDirectoryPath(canonicalPath);
  if (branchAncestors.has(normalized)) return null;
  if (budget.visitedDirectories >= budget.maxDirectories) {
    throw new Error(`Directory traversal directory limit exceeded (${budget.maxDirectories})`);
  }
  budget.visitedDirectories += 1;
  branchAncestors.add(normalized);
  return normalized;
}

export function releaseSftpDirectoryVisit(
  _budget: SftpDirectoryTraversalBudget,
  claimedCanonicalPath: string,
  branchAncestors: Set<string> = _budget.activeCanonicalDirectories,
): void {
  branchAncestors.delete(claimedCanonicalPath);
}

export function accountSftpDirectoryEntries(
  budget: SftpDirectoryTraversalBudget,
  count: number,
): void {
  const next = budget.visitedEntries + Math.max(0, Number(count) || 0);
  if (next > budget.maxEntries) {
    throw new Error(`Directory traversal entry limit exceeded (${budget.maxEntries})`);
  }
  budget.visitedEntries = next;
}

export function shouldFollowSftpSymlinkDirectory(symlinkDepth: number): boolean {
  return symlinkDepth < MAX_SFTP_FOLLOWED_SYMLINK_DEPTH;
}

const SHA256_TEXT_ENCODER = new TextEncoder();
const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_WORK_SCHEDULE = new Uint32Array(64);
const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const HEX_CHARACTER_CODES = new Uint8Array(
  Array.from("0123456789abcdef", (character) => character.charCodeAt(0)),
);

function compressSha256Block(state: Uint32Array, block: Uint8Array): void {
  const W = SHA256_WORK_SCHEDULE;
  const view = new DataView(block.buffer, block.byteOffset, 64);
  for (let i = 0; i < 16; i += 1) W[i] = view.getUint32(i * 4, false);
  for (let i = 16; i < 64; i += 1) {
    const s0 = ((W[i - 15] >>> 7) | (W[i - 15] << 25))
      ^ ((W[i - 15] >>> 18) | (W[i - 15] << 14)) ^ (W[i - 15] >>> 3);
    const s1 = ((W[i - 2] >>> 17) | (W[i - 2] << 15))
      ^ ((W[i - 2] >>> 19) | (W[i - 2] << 13)) ^ (W[i - 2] >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = 0; i < 64; i += 1) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const temp1 = (h + s1 + ch + SHA256_ROUND_CONSTANTS[i] + W[i]) >>> 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (s0 + majority) >>> 0;
    h = g; g = f; f = e; e = (d + temp1) >>> 0;
    d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
  }
  state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
  state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
  state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
}

// Synchronous SHA-256 keeps transfer-history pruning deterministic and avoids
// making every React/store lifecycle update asynchronous.
function sha256Hex(value: string): string {
  const data = SHA256_TEXT_ENCODER.encode(value);
  const bitLength = BigInt(data.length) * 8n;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, bitLength, false);
  const H = new Uint32Array([
    ...SHA256_INITIAL_STATE,
  ]);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    compressSha256Block(H, padded.subarray(chunk, chunk + 64));
  }
  return Array.from(H, (word) => word.toString(16).padStart(8, "0")).join("");
}

export function createDirectoryEntryIdentity(entry: {
  sourcePath: string;
  targetPath: string;
  size: number;
  lastModified?: number;
}): string {
  return sha256Hex(JSON.stringify([
    entry.sourcePath,
    entry.targetPath,
    Math.max(0, Number(entry.size) || 0),
    Number(entry.lastModified) || 0,
  ]));
}

export function appendDirectoryManifestIdentity(manifestHash: string, entryIdentity: string): string {
  const accumulator = createDirectoryManifestAccumulator({ version: 1, manifestHash });
  accumulator.append(entryIdentity);
  return accumulator.digest();
}

/**
 * Version 2 consumes one already-hashed, fixed-width identity as exactly one
 * SHA-256 block. Persisting the compression state makes each append O(1) with
 * one round set instead of hashing the previous digest and wrapper again.
 */
export function appendDirectoryManifestIdentityV2(manifestState: string, entryIdentity: string): string {
  const accumulator = createDirectoryManifestAccumulator({ version: 2, manifestHash: manifestState });
  accumulator.append(entryIdentity);
  return accumulator.digest();
}

export interface DirectoryManifestAccumulator {
  append(entryIdentity: string): void;
  digest(): string;
}

/** Parse/format the persisted state only once when processing a large prefix. */
export function createDirectoryManifestAccumulator(
  checkpoint: Pick<DirectoryResumeCheckpoint, "version" | "manifestHash">,
): DirectoryManifestAccumulator {
  if (checkpoint.version === 1) {
    if (!/^[a-f0-9]{64}$/.test(checkpoint.manifestHash)) {
      throw new Error("Invalid directory manifest state");
    }
    // A legacy chain hashes exactly 129 ASCII bytes each time:
    // previousHash + ':' + entryIdentity. Reuse its three padded SHA blocks
    // and carry the digest bytes forward without allocating strings/buffers per
    // entry. This keeps old persisted checkpoints fast on their first resume.
    const message = new Uint8Array(192);
    const state = new Uint32Array(8);
    for (let index = 0; index < 64; index += 1) {
      message[index] = checkpoint.manifestHash.charCodeAt(index);
    }
    message[64] = 0x3a;
    message[129] = 0x80;
    new DataView(message.buffer).setBigUint64(184, 129n * 8n, false);
    return {
      append(entryIdentity) {
        if (!/^[a-f0-9]{64}$/.test(entryIdentity)) {
          throw new Error("Invalid directory manifest identity");
        }
        for (let index = 0; index < 64; index += 1) {
          message[index + 65] = entryIdentity.charCodeAt(index);
        }
        state.set(SHA256_INITIAL_STATE);
        compressSha256Block(state, message.subarray(0, 64));
        compressSha256Block(state, message.subarray(64, 128));
        compressSha256Block(state, message.subarray(128, 192));
        for (let wordIndex = 0; wordIndex < 8; wordIndex += 1) {
          const word = state[wordIndex];
          for (let nibbleIndex = 0; nibbleIndex < 8; nibbleIndex += 1) {
            const shift = (7 - nibbleIndex) * 4;
            message[wordIndex * 8 + nibbleIndex] = HEX_CHARACTER_CODES[(word >>> shift) & 0x0f];
          }
        }
      },
      digest: () => String.fromCharCode(...message.subarray(0, 64)),
    };
  }
  const manifestState = checkpoint.manifestHash;
  if (!/^[a-f0-9]{64}$/.test(manifestState)) {
    throw new Error("Invalid directory manifest state");
  }
  const state = new Uint32Array(8);
  const block = new Uint8Array(64);
  for (let index = 0; index < 8; index += 1) {
    state[index] = Number.parseInt(manifestState.slice(index * 8, index * 8 + 8), 16) >>> 0;
  }
  return {
    append(entryIdentity) {
      if (!/^[a-f0-9]{64}$/.test(entryIdentity)) {
        throw new Error("Invalid directory manifest identity");
      }
      for (let index = 0; index < 64; index += 1) {
        block[index] = entryIdentity.charCodeAt(index);
      }
      compressSha256Block(state, block);
    },
    digest: () => Array.from(
      state,
      (word) => word.toString(16).padStart(8, "0"),
    ).join(""),
  };
}

export function appendDirectoryCheckpointIdentity(
  checkpoint: Pick<DirectoryResumeCheckpoint, "version" | "manifestHash">,
  entryIdentity: string,
): string {
  const accumulator = createDirectoryManifestAccumulator(checkpoint);
  accumulator.append(entryIdentity);
  return accumulator.digest();
}

/** Directory traversal order: child directories first, then files, names sorted. */
export function compareDirectoryTraversalPaths(left: string, right: string): number {
  const leftParts = left.replace(/\\/g, "/").split("/").filter(Boolean);
  const rightParts = right.replace(/\\/g, "/").split("/").filter(Boolean);
  const length = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftIsDirectory = index < leftParts.length - 1;
    const rightIsDirectory = index < rightParts.length - 1;
    if (leftIsDirectory !== rightIsDirectory) return leftIsDirectory ? -1 : 1;
    const compared = leftParts[index].localeCompare(rightParts[index]);
    if (compared !== 0) return compared;
  }
  return leftParts.length - rightParts.length;
}

export function createEmptyDirectoryResumeCheckpoint(): DirectoryResumeCheckpoint {
  return {
    version: DIRECTORY_RESUME_CHECKPOINT_VERSION,
    coveredEntries: 0,
    completedEntries: 0,
    manifestHash: EMPTY_DIRECTORY_MANIFEST_STATE_V2,
  };
}

export function isValidDirectoryResumeCheckpoint(value: unknown): value is DirectoryResumeCheckpoint {
  if (!value || typeof value !== "object") return false;
  const checkpoint = value as Partial<DirectoryResumeCheckpoint>;
  return (checkpoint.version === 1 || checkpoint.version === 2)
    && Number.isSafeInteger(checkpoint.coveredEntries)
    && (checkpoint.coveredEntries ?? -1) >= 0
    && Number.isSafeInteger(checkpoint.completedEntries)
    && (checkpoint.completedEntries ?? -1) >= 0
    && (checkpoint.completedEntries ?? 0) <= (checkpoint.coveredEntries ?? -1)
    && typeof checkpoint.manifestHash === "string"
    && /^[a-f0-9]{64}$/.test(checkpoint.manifestHash);
}
