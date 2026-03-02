/**
 * Characterization tests for DnD collision detection in admin content lists.
 *
 * These tests exercise the closestCenter algorithm from @dnd-kit/core and
 * demonstrate a bug where display:contents on the droppable wrapper causes
 * getBoundingClientRect() to return {0,0,0,0}, making closestCenter always
 * pick index 0 instead of the geometrically correct adjacent row.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Resolve @dnd-kit/core from frontend/node_modules since it is not
// installed at the repository root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);
const dndCorePath = require.resolve('@dnd-kit/core', {
  paths: [resolve(projectRoot, 'frontend/node_modules')],
});
const { closestCenter } = await import(dndCorePath);

// ---------------------------------------------------------------------------
// Replicated from ListsFolder.jsx (not exported, has React deps)
// ---------------------------------------------------------------------------
function dualCollisionDetection(args) {
  const activeId = String(args.active.id);
  if (activeId.startsWith('content-')) {
    const filtered = args.droppableContainers.filter(
      (c) => String(c.id).startsWith('content-') && c.id !== args.active.id,
    );
    return closestCenter({ ...args, droppableContainers: filtered });
  }
  return closestCenter(args);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Row height used in the admin list UI. */
const ROW_HEIGHT = 44;

/** Content zone x/width constants. */
const CONTENT_LEFT = 300;
const CONTENT_WIDTH = 600;

/**
 * Build a mock droppable container matching the shape dnd-kit expects.
 * @param {string} id   — e.g. 'content-0-3'
 * @param {{left:number,top:number,right:number,bottom:number,width:number,height:number}} rect
 */
function makeContainer(id, rect) {
  return {
    id,
    node: { current: null },
    rect: {
      current: {
        ...rect,
        toJSON: () => rect,
      },
    },
    data: { current: null },
    disabled: false,
  };
}

/**
 * Build a properly-sized container for a given row index.
 * Each row is ROW_HEIGHT tall, content starts at CONTENT_LEFT.
 */
function makeContentContainer(sectionIndex, rowIndex) {
  const top = rowIndex * ROW_HEIGHT;
  const rect = {
    left: CONTENT_LEFT,
    top,
    right: CONTENT_LEFT + CONTENT_WIDTH,
    bottom: top + ROW_HEIGHT,
    width: CONTENT_WIDTH,
    height: ROW_HEIGHT,
  };
  return makeContainer(`content-${sectionIndex}-${rowIndex}`, rect);
}

/**
 * Build a row container (used for row-level reordering).
 */
function makeRowContainer(sectionIndex, rowIndex) {
  const top = rowIndex * ROW_HEIGHT;
  const rect = {
    left: 0,
    top,
    right: CONTENT_LEFT + CONTENT_WIDTH,
    bottom: top + ROW_HEIGHT,
    width: CONTENT_LEFT + CONTENT_WIDTH,
    height: ROW_HEIGHT,
  };
  return makeContainer(`row-${sectionIndex}-${rowIndex}`, rect);
}

/**
 * Build a zero-size container (simulates display:contents bug).
 */
function makeZeroRectContainer(id) {
  const rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  return makeContainer(id, rect);
}

/**
 * Build closestCenter args given an active id, a collision rect (pointer area),
 * and a list of droppable containers.
 */
function makeArgs(activeId, collisionRect, containers) {
  return {
    active: { id: activeId },
    collisionRect,
    droppableRects: new Map(containers.map((c) => [c.id, c.rect.current])),
    droppableContainers: containers,
  };
}

/**
 * Small pointer-sized collision rect centered between two rows.
 * Simulates the user dragging upward from row `fromIndex` toward `toIndex`.
 * The pointer sits at the vertical midpoint between the two row centers.
 */
function pointerBetweenRows(fromIndex, toIndex) {
  const fromCenter = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
  const toCenter = toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
  const y = (fromCenter + toCenter) / 2;
  const x = CONTENT_LEFT + CONTENT_WIDTH / 2;
  const size = 4; // small pointer rect
  return {
    left: x - size / 2,
    top: y - size / 2,
    right: x + size / 2,
    bottom: y + size / 2,
    width: size,
    height: size,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('content DnD collision detection', () => {
  // 6 rows in section 0 (indices 0..5)
  const SECTION = 0;
  const ROW_COUNT = 6;

  /** Properly-sized content containers for all rows. */
  const goodContainers = Array.from({ length: ROW_COUNT }, (_, i) =>
    makeContentContainer(SECTION, i),
  );

  /** Zero-rect content containers (the display:contents bug). */
  const buggyContainers = Array.from({ length: ROW_COUNT }, (_, i) =>
    makeZeroRectContainer(`content-${SECTION}-${i}`),
  );

  // ---- Test 1 ---------------------------------------------------------
  test('closestCenter selects adjacent row (index 3) when dragging from row 5 upward toward row 4', () => {
    // Active item is row 5 (index 4), dragging toward row 4 (index 3).
    const activeId = `content-${SECTION}-4`;
    const pointer = pointerBetweenRows(4, 3);

    // Exclude the active container (dnd-kit does this internally).
    const others = goodContainers.filter((c) => c.id !== activeId);
    const args = makeArgs(activeId, pointer, others);
    const collisions = closestCenter(args);

    expect(collisions.length).toBeGreaterThan(0);
    // The first (closest) collision should be index 3.
    expect(collisions[0].id).toBe(`content-${SECTION}-3`);
  });

  // ---- Test 2 ---------------------------------------------------------
  test('row 0 is NOT selected when dragging between rows 4 and 3', () => {
    const activeId = `content-${SECTION}-4`;
    const pointer = pointerBetweenRows(4, 3);

    const others = goodContainers.filter((c) => c.id !== activeId);
    const args = makeArgs(activeId, pointer, others);
    const collisions = closestCenter(args);

    // Row 0 should NOT be the closest match.
    expect(collisions[0].id).not.toBe(`content-${SECTION}-0`);
  });

  // ---- Test 3 ---------------------------------------------------------
  test('dualCollisionDetection filters content drags to only content containers', () => {
    // Mix of row and content containers
    const mixed = [
      ...Array.from({ length: ROW_COUNT }, (_, i) =>
        makeRowContainer(SECTION, i),
      ),
      ...goodContainers,
    ];

    const activeId = `content-${SECTION}-4`;
    const pointer = pointerBetweenRows(4, 3);
    const args = makeArgs(activeId, pointer, mixed);
    const collisions = dualCollisionDetection(args);

    // All returned collision ids should be content- prefixed (no row- ids).
    for (const collision of collisions) {
      expect(String(collision.id).startsWith('content-')).toBe(true);
    }
    // And the active item should not appear in results.
    const ids = collisions.map((c) => c.id);
    expect(ids).not.toContain(activeId);
  });

  // ---- Test 4 ---------------------------------------------------------
  test('BUG: zero-size rects cause closestCenter to pick index 0 instead of adjacent index 3', () => {
    const activeId = `content-${SECTION}-4`;
    const pointer = pointerBetweenRows(4, 3);

    const others = buggyContainers.filter((c) => c.id !== activeId);
    const args = makeArgs(activeId, pointer, others);
    const collisions = closestCenter(args);

    // With zero-size rects, all centers are at (0,0). closestCenter
    // computes identical distances for every container. The sort is
    // stable, so the first container in the input array wins — that is
    // index 0, not the geometrically correct index 3.
    //
    // NOTE: closestCenter skips containers whose rect is not found in
    // droppableRects. With zero-size rects the rect IS present (it is
    // just {0,0,0,0}), so all containers are considered.
    expect(collisions.length).toBeGreaterThan(0);

    // The bug: the winner is index 0 (wrong).
    expect(collisions[0].id).toBe(`content-${SECTION}-0`);

    // The correct answer would be index 3 (adjacent to the drag source).
    expect(collisions[0].id).not.toBe(`content-${SECTION}-3`);
  });
});
