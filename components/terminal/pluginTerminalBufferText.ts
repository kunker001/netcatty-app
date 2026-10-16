import type { IBufferLine } from '@xterm/xterm';

export interface PluginTerminalBufferText {
  readonly text: string;
  /** Maps UTF-16 string boundaries to zero-based xterm cell boundaries. */
  readonly cellAtStringOffset: readonly number[];
}

function identityMapping(text: string): PluginTerminalBufferText {
  return Object.freeze({
    text,
    cellAtStringOffset: Object.freeze(Array.from({ length: text.length + 1 }, (_, index) => index)),
  });
}

export function readPluginTerminalBufferText(
  line: IBufferLine,
  trimRight: boolean,
): PluginTerminalBufferText {
  if (typeof line.getCell !== 'function' || !Number.isInteger(line.length) || line.length < 0) {
    return identityMapping(line.translateToString(trimRight));
  }
  let text = '';
  const cellAtStringOffset: number[] = [0];
  for (let cellIndex = 0; cellIndex < line.length; cellIndex += 1) {
    const cell = line.getCell(cellIndex);
    if (!cell) continue;
    const width = cell.getWidth();
    if (width === 0) continue;
    const characters = cell.getChars() || ' ';
    const startOffset = text.length;
    text += characters;
    for (let offset = startOffset; offset < text.length; offset += 1) {
      cellAtStringOffset[offset] = cellIndex;
    }
    cellAtStringOffset[text.length] = cellIndex + Math.max(1, width);
  }
  if (trimRight) {
    const trimmed = text.trimEnd();
    cellAtStringOffset.length = trimmed.length + 1;
    text = trimmed;
  }
  return Object.freeze({ text, cellAtStringOffset: Object.freeze(cellAtStringOffset) });
}

export function pluginTerminalCellRange(
  line: PluginTerminalBufferText,
  start: number,
  length: number,
): { x: number; width: number } | null {
  const startCell = line.cellAtStringOffset[start];
  const endCell = line.cellAtStringOffset[start + length];
  if (!Number.isInteger(startCell) || !Number.isInteger(endCell) || endCell <= startCell) return null;
  return { x: startCell, width: endCell - startCell };
}
