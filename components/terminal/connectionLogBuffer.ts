/**
 * A bounded, append-only text buffer that retains only the last `maxChars`
 * characters — the connection log used for diagnostics/replay.
 *
 * The naive implementation (`log += chunk; if (log.length > max) log =
 * log.slice(-max)`) flattens a ~max-length string on *every* append once the
 * cap is reached — on the render thread, for every output chunk including each
 * echoed keystroke.
 *
 * Instead, data is coalesced into a small, bounded number of fixed-size blocks
 * (~`maxChars / blockSize`, e.g. ~16 for the 1 MB cap). New data accumulates in
 * an open `tail`; once it reaches `blockSize` it is sealed into a block. Trimming
 * the oldest data therefore only ever drops/slices a handful of blocks — never
 * one array element per append, which would make trim O(number of appends) and
 * defeat the purpose. Append is amortized O(chunk); the full string is
 * materialized only on `toString()` (called rarely, on finalize).
 */
export interface ConnectionLogBuffer {
  append(chunk: string): void;
  toString(): string;
  reset(): void;
  /**
   * Number of internal string segments currently retained. Exposed for tests
   * to assert the bounded-memory / bounded-trim property.
   */
  segmentCount(): number;
}

const DEFAULT_BLOCK_SIZE = 64 * 1024;

export function createConnectionLogBuffer(
  maxChars: number,
  blockSize: number = DEFAULT_BLOCK_SIZE,
): ConnectionLogBuffer {
  let blocks: string[] = []; // sealed blocks, oldest first, each up to ~blockSize
  let tail = ""; // open block currently being filled (newest data)
  let total = 0; // total retained length across blocks + tail

  const trim = () => {
    let overflow = total - maxChars;
    if (overflow <= 0) return;
    // Drop/slice whole blocks from the front. `blocks.length` is bounded by
    // ~maxChars/blockSize, so this shift is O(small constant), not O(appends).
    while (overflow > 0 && blocks.length > 0) {
      const head = blocks[0];
      if (head.length <= overflow) {
        blocks.shift();
        total -= head.length;
        overflow -= head.length;
      } else {
        blocks[0] = head.slice(overflow);
        total -= overflow;
        overflow = 0;
      }
    }
    // Only reachable when the tail alone exceeds the cap (e.g. blockSize >=
    // maxChars); keep its last `maxChars` characters.
    if (overflow > 0) {
      tail = tail.slice(overflow);
      total -= overflow;
    }
  };

  return {
    append(chunk: string): void {
      if (!chunk) return;
      // A single chunk at/over the cap can only contribute its own tail.
      if (chunk.length >= maxChars) {
        blocks = [];
        tail = chunk.slice(chunk.length - maxChars);
        total = tail.length;
        return;
      }
      tail += chunk;
      total += chunk.length;
      if (tail.length >= blockSize) {
        blocks.push(tail);
        tail = "";
      }
      if (total > maxChars) trim();
    },
    toString(): string {
      return blocks.length > 0 ? blocks.join("") + tail : tail;
    },
    reset(): void {
      blocks = [];
      tail = "";
      total = 0;
    },
    segmentCount(): number {
      return blocks.length + (tail.length > 0 ? 1 : 0);
    },
  };
}
