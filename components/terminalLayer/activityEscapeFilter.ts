import { canRetainIncompleteTerminalControlSequence } from "../terminal/runtime/terminalControlSequenceLimits";

// eslint-disable-next-line no-control-regex
const TERMINAL_OSC_SEQUENCE_REGEX = new RegExp("\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)", "g");
// eslint-disable-next-line no-control-regex
const TERMINAL_ESCAPE_SEQUENCE_REGEX = new RegExp("\\u001B(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])", "g");
// eslint-disable-next-line no-control-regex
const TERMINAL_CONTROL_CHAR_REGEX = new RegExp("[\\u0000-\\u0008\\u000B-\\u001F\\u007F]", "g");
// eslint-disable-next-line no-control-regex
const INCOMPLETE_ESCAPE_TAIL_REGEX = new RegExp("\\u001B(?:\\][^\\u0007\\u001B]*(?:\\u001B)?|\\[[0-?]*[ -/]*)?$");

const stripTerminalControlSequences = (data: string): string => data
  .replace(TERMINAL_OSC_SEQUENCE_REGEX, "")
  .replace(TERMINAL_ESCAPE_SEQUENCE_REGEX, "")
  .replace(TERMINAL_CONTROL_CHAR_REGEX, "");

export class ChunkedEscapeFilter {
  private pending = "";

  feed(chunk: string): string {
    const data = this.pending + chunk;
    const tailMatch = INCOMPLETE_ESCAPE_TAIL_REGEX.exec(data);
    if (tailMatch) {
      const incomplete = tailMatch[0];
      if (canRetainIncompleteTerminalControlSequence(incomplete)) {
        this.pending = incomplete;
        return stripTerminalControlSequences(data.slice(0, tailMatch.index));
      }
      // Fail open after the safety budget. This filter is only an activity
      // classifier; retaining an unterminated OSC/DCS forever is worse than
      // treating its payload as visible activity once.
      this.pending = "";
      return `${stripTerminalControlSequences(data.slice(0, tailMatch.index))}${incomplete}`;
    }
    this.pending = "";
    return stripTerminalControlSequences(data);
  }
}

export const hasNotifiableTerminalOutput = (filter: ChunkedEscapeFilter, chunk: string): boolean => (
  filter.feed(chunk).trim().length > 0
);
