import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTerminalSettings } from "./models/terminal.ts";
import {
  normalizeInlineImageMaxMegapixels,
  normalizeInlineImageSequenceLimitMb,
  normalizeInlineImageStorageLimitMb,
  resolveTerminalInlineImageAddonOptions,
  resolveTerminalInlineImagesEnabled,
  TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_DEFAULT,
  TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MAX,
  TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MIN,
  TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_DEFAULT,
  TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MAX,
  TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MIN,
  TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_DEFAULT,
  TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MAX,
  TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MIN,
} from "./terminalInlineImages.ts";

const allProtocols = {
  inlineImagesEnabled: true,
  inlineImageKittyEnabled: true,
  inlineImageSixelEnabled: true,
  inlineImageIipEnabled: true,
};

test("inline image limits clamp untrusted persisted values", () => {
  assert.equal(
    normalizeInlineImageStorageLimitMb(1),
    TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MIN,
  );
  assert.equal(
    normalizeInlineImageStorageLimitMb(100_000),
    TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MAX,
  );
  assert.equal(
    normalizeInlineImageStorageLimitMb("128"),
    TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_DEFAULT,
  );
  assert.equal(
    normalizeInlineImageStorageLimitMb(Number.NaN),
    TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_DEFAULT,
  );
  assert.equal(normalizeInlineImageStorageLimitMb(64.4), 64);

  assert.equal(
    normalizeInlineImageMaxMegapixels(0),
    TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MIN,
  );
  assert.equal(
    normalizeInlineImageMaxMegapixels(4096),
    TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MAX,
  );
  assert.equal(
    normalizeInlineImageMaxMegapixels(undefined),
    TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_DEFAULT,
  );

  assert.equal(
    normalizeInlineImageSequenceLimitMb(-5),
    TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MIN,
  );
  assert.equal(
    normalizeInlineImageSequenceLimitMb(999),
    TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MAX,
  );
  assert.equal(
    normalizeInlineImageSequenceLimitMb(null),
    TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_DEFAULT,
  );
});

test("inline images stay off unless the master switch and one protocol are on", () => {
  assert.equal(resolveTerminalInlineImagesEnabled(), false);
  assert.equal(resolveTerminalInlineImagesEnabled({ ...allProtocols, inlineImagesEnabled: false }), false);
  assert.equal(
    resolveTerminalInlineImagesEnabled({
      inlineImagesEnabled: true,
      inlineImageKittyEnabled: false,
      inlineImageSixelEnabled: false,
      inlineImageIipEnabled: false,
    }),
    false,
  );
  assert.equal(
    resolveTerminalInlineImagesEnabled({
      inlineImagesEnabled: true,
      inlineImageKittyEnabled: true,
      inlineImageSixelEnabled: false,
      inlineImageIipEnabled: false,
    }),
    true,
  );
});

test("disabled inline images produce no addon options at all", () => {
  assert.equal(resolveTerminalInlineImageAddonOptions(null), null);
  assert.equal(
    resolveTerminalInlineImageAddonOptions({ ...allProtocols, inlineImagesEnabled: false }),
    null,
  );
  assert.equal(
    resolveTerminalInlineImageAddonOptions({
      inlineImagesEnabled: true,
      inlineImageKittyEnabled: false,
      inlineImageSixelEnabled: false,
      inlineImageIipEnabled: false,
    }),
    null,
  );
});

test("addon options convert user units into addon units and clamp them", () => {
  const options = resolveTerminalInlineImageAddonOptions({
    ...allProtocols,
    inlineImageStorageLimitMb: 64,
    inlineImageMaxMegapixels: 4,
    inlineImageSequenceLimitMb: 8,
  });

  assert.ok(options);
  assert.equal(options.storageLimit, 64, "storage limit is passed through in MB");
  assert.equal(options.pixelLimit, 4 * 1024 * 1024, "megapixels become a pixel count");
  assert.equal(options.sixelSizeLimit, 8 * 1024 * 1024, "sequence limit becomes bytes");
  assert.equal(options.iipSizeLimit, options.sixelSizeLimit);
  assert.equal(options.kittySizeLimit, options.sixelSizeLimit);
  assert.equal(options.enableSizeReports, true, "image producers need CSI 14/16/18 t");
  assert.equal(options.showPlaceholder, true);

  const clamped = resolveTerminalInlineImageAddonOptions({
    ...allProtocols,
    inlineImageStorageLimitMb: 100_000,
    inlineImageMaxMegapixels: 100_000,
    inlineImageSequenceLimitMb: 100_000,
  });

  assert.ok(clamped);
  assert.equal(clamped.storageLimit, TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MAX);
  assert.equal(
    clamped.pixelLimit,
    TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MAX * 1024 * 1024,
  );
  assert.equal(
    clamped.kittySizeLimit,
    TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MAX * 1024 * 1024,
  );
});

test("each protocol switch maps to its own addon support flag", () => {
  const kittyOnly = resolveTerminalInlineImageAddonOptions({
    inlineImagesEnabled: true,
    inlineImageKittyEnabled: true,
    inlineImageSixelEnabled: false,
    inlineImageIipEnabled: false,
  });

  assert.ok(kittyOnly);
  assert.equal(kittyOnly.kittySupport, true);
  assert.equal(kittyOnly.sixelSupport, false);
  assert.equal(kittyOnly.iipSupport, false);
});

test("terminal settings default to inline images off with clamped limits", () => {
  const defaults = normalizeTerminalSettings();

  assert.equal(defaults.inlineImagesEnabled, false);
  assert.equal(defaults.inlineImageKittyEnabled, true);
  assert.equal(defaults.inlineImageSixelEnabled, true);
  assert.equal(defaults.inlineImageIipEnabled, true);
  assert.equal(defaults.inlineImageStorageLimitMb, TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_DEFAULT);
  assert.equal(defaults.inlineImageMaxMegapixels, TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_DEFAULT);
  assert.equal(defaults.inlineImageSequenceLimitMb, TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_DEFAULT);

  const restored = normalizeTerminalSettings({
    inlineImageStorageLimitMb: 4096,
    inlineImageMaxMegapixels: 0,
    inlineImageSequenceLimitMb: -1,
  } as never);

  assert.equal(restored.inlineImageStorageLimitMb, TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MAX);
  assert.equal(restored.inlineImageMaxMegapixels, TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MIN);
  assert.equal(restored.inlineImageSequenceLimitMb, TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MIN);
});
