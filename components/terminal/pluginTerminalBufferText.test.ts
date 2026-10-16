import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pluginTerminalCellRange,
  readPluginTerminalBufferText,
} from './pluginTerminalBufferText.ts';

test('plugin terminal buffer text maps wide and combining characters to xterm cells', () => {
  const cells = [
    { chars: 'A', width: 1 },
    { chars: '界', width: 2 },
    { chars: '', width: 0 },
    { chars: 'e\u0301', width: 1 },
    { chars: '', width: 1 },
  ];
  const line = {
    length: cells.length,
    getCell(index: number) {
      const cell = cells[index];
      return cell ? { getChars: () => cell.chars, getWidth: () => cell.width } : undefined;
    },
    translateToString() { return 'A界e\u0301 '; },
  };
  const result = readPluginTerminalBufferText(line as never, true);
  assert.equal(result.text, 'A界e\u0301');
  assert.deepEqual(pluginTerminalCellRange(result, 1, 1), { x: 1, width: 2 });
  assert.deepEqual(pluginTerminalCellRange(result, 2, 2), { x: 3, width: 1 });
  assert.equal(pluginTerminalCellRange(result, 2, 1), null);
});
