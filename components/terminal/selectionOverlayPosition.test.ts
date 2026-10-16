import test from "node:test";
import assert from "node:assert/strict";
import { resolveSelectionOverlayPosition } from "./useTerminalEffects";

function createRect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function createContainer(offsetTop = 30) {
  const screen = {
    clientWidth: 800,
    clientHeight: 400,
    getBoundingClientRect: () => createRect(10, 20, 800, 400),
  };
  return {
    clientWidth: 1000,
    clientHeight: 600,
    offsetLeft: 0,
    offsetTop,
    querySelector: () => screen,
    getBoundingClientRect: () => createRect(0, 0, 1000, 600),
  } as unknown as HTMLElement;
}

function createTerm(range: { start: { x: number; y: number }; end: { x: number; y: number } }, viewportY = 5) {
  return {
    rows: 20,
    cols: 80,
    buffer: {
      active: {
        viewportY,
      },
    },
    getSelection: () => "selected output",
    getSelectionPosition: () => range,
  };
}

test("resolveSelectionOverlayPosition anchors to the top-right of a single-line selection", () => {
  const position = resolveSelectionOverlayPosition(
    createTerm({ start: { x: 5, y: 10 }, end: { x: 15, y: 10 } }),
    createContainer(),
  );

  assert.deepEqual(position, { left: 168, top: 142 });
});

test("resolveSelectionOverlayPosition anchors multi-line selections to the visible row right edge", () => {
  const position = resolveSelectionOverlayPosition(
    createTerm({ start: { x: 4, y: 12 }, end: { x: 20, y: 14 } }, 10),
    createContainer(),
  );

  assert.deepEqual(position, { left: 818, top: 82 });
});

test("resolveSelectionOverlayPosition clamps near the top edge", () => {
  const position = resolveSelectionOverlayPosition(
    createTerm({ start: { x: 1, y: 5 }, end: { x: 4, y: 5 } }),
    createContainer(0),
  );

  assert.equal(position?.top, 36);
});

test("resolveSelectionOverlayPosition returns null when the selected row is offscreen", () => {
  const position = resolveSelectionOverlayPosition(
    createTerm({ start: { x: 1, y: 2 }, end: { x: 4, y: 2 } }, 5),
    createContainer(),
  );

  assert.equal(position, null);
});
