import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('gpu vendor badge embeds monochrome vector marks for nvidia and ascend', () => {
  const source = readFileSync(new URL('./GpuVendorBadge.tsx', import.meta.url), 'utf8');
  assert.match(source, /viewBox="0 0 24 24"/);
  assert.match(source, /fill-current/);
  assert.match(source, /NVIDIA_PATH/);
  assert.match(source, /HUAWEI_PATH/);
  assert.match(source, /GpuVendorBadge/);
  assert.match(source, /vendorDisplayLabel/);
  // Mark is decorative; text label is the accessible name (no double announce).
  assert.match(source, /aria-hidden="true"/);
  assert.doesNotMatch(source, /role="img"/);
});
