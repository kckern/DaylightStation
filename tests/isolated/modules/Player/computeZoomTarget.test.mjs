import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Replicated from frontend/src/modules/Player/renderers/ImageFrame.jsx
 *
 * computeZoomTarget is a pure function that computes Ken Burns animation
 * zoom targets based on face bounding box data from Immich.  It is NOT
 * exported from ImageFrame, so we duplicate the algorithm here for
 * isolated unit testing.
 *
 * Three code paths:
 *   1. focusPerson targeting — zoom toward a named person's face center
 *   2. Largest face fallback — pick the biggest bounding box
 *   3. Random fallback — random point in center 60% of the image
 */
function computeZoomTarget({ people, focusPerson, zoom }) {
  const maxTranslate = ((zoom - 1) / zoom) * 50;

  let targetX = 0.5;
  let targetY = 0.5;
  let found = false;
  let strategy = 'random';

  const allFaces = (people || []).flatMap(p =>
    (p.faces || []).map(f => ({ ...f, personName: p.name }))
  );

  if (focusPerson && allFaces.length > 0) {
    const match = allFaces.find(f =>
      f.personName?.toLowerCase() === focusPerson.toLowerCase()
    );
    if (match && match.imageWidth && match.imageHeight) {
      targetX = ((match.x1 + match.x2) / 2) / match.imageWidth;
      targetY = ((match.y1 + match.y2) / 2) / match.imageHeight;
      found = true;
      strategy = 'focus-person';
    }
  }

  if (!found && allFaces.length > 0) {
    let largest = allFaces[0];
    let largestArea = 0;
    for (const f of allFaces) {
      const area = Math.abs((f.x2 - f.x1) * (f.y2 - f.y1));
      if (area > largestArea) {
        largestArea = area;
        largest = f;
      }
    }
    if (largest.imageWidth && largest.imageHeight) {
      targetX = ((largest.x1 + largest.x2) / 2) / largest.imageWidth;
      targetY = ((largest.y1 + largest.y2) / 2) / largest.imageHeight;
      found = true;
      strategy = 'largest-face';
    }
  }

  if (!found) {
    targetX = 0.2 + Math.random() * 0.6;
    targetY = 0.2 + Math.random() * 0.6;
  }

  const startOffX = (0.5 - targetX) * maxTranslate * 0.3;
  const startOffY = (0.5 - targetY) * maxTranslate * 0.3;
  const endOffX = (0.5 - targetX) * maxTranslate;
  const endOffY = (0.5 - targetY) * maxTranslate;

  return {
    startX: `${startOffX.toFixed(2)}%`,
    startY: `${startOffY.toFixed(2)}%`,
    endX: `${endOffX.toFixed(2)}%`,
    endY: `${endOffY.toFixed(2)}%`,
    strategy,
  };
}


// ── Helpers ─────────────────────────────────────────────────────────────

/** Build a face bounding box positioned at a known center (as fraction of image dims). */
function makeFace({ centerX, centerY, width = 100, height = 100, imageWidth = 1000, imageHeight = 1000 }) {
  const halfW = width / 2;
  const halfH = height / 2;
  const cx = centerX * imageWidth;
  const cy = centerY * imageHeight;
  return {
    x1: cx - halfW,
    y1: cy - halfH,
    x2: cx + halfW,
    y2: cy + halfH,
    imageWidth,
    imageHeight,
  };
}

function makePerson(name, faces) {
  return { name, faces };
}

/** Parse the "12.34%" string format back to a number. */
function pct(str) {
  return parseFloat(str.replace('%', ''));
}


// ── Tests ───────────────────────────────────────────────────────────────

describe('computeZoomTarget', () => {
  const defaultZoom = 1.2;

  // ── focusPerson targeting ───────────────────────────────────────────
  describe('focusPerson targeting', () => {
    it('zooms toward named person face center', () => {
      const alice = makePerson('Alice', [makeFace({ centerX: 0.3, centerY: 0.4 })]);
      const bob   = makePerson('Bob',   [makeFace({ centerX: 0.7, centerY: 0.8 })]);
      const result = computeZoomTarget({
        people: [alice, bob],
        focusPerson: 'Alice',
        zoom: defaultZoom,
      });

      expect(result.strategy).toBe('focus-person');

      // Alice is at (0.3, 0.4) — left of center, above center.
      // endOffX = (0.5 - 0.3) * maxTranslate = positive (translate right toward her)
      // endOffY = (0.5 - 0.4) * maxTranslate = positive (translate down toward her)
      const maxTranslate = ((defaultZoom - 1) / defaultZoom) * 50;
      const expectedEndX = (0.5 - 0.3) * maxTranslate;
      const expectedEndY = (0.5 - 0.4) * maxTranslate;
      expect(pct(result.endX)).toBeCloseTo(expectedEndX, 1);
      expect(pct(result.endY)).toBeCloseTo(expectedEndY, 1);
    });

    it('performs case-insensitive person name matching', () => {
      const alice = makePerson('Alice', [makeFace({ centerX: 0.3, centerY: 0.4 })]);

      const lower = computeZoomTarget({ people: [alice], focusPerson: 'alice', zoom: defaultZoom });
      const upper = computeZoomTarget({ people: [alice], focusPerson: 'ALICE', zoom: defaultZoom });
      const mixed = computeZoomTarget({ people: [alice], focusPerson: 'aLiCe', zoom: defaultZoom });

      expect(lower.strategy).toBe('focus-person');
      expect(upper.strategy).toBe('focus-person');
      expect(mixed.strategy).toBe('focus-person');

      // All three should produce identical zoom coordinates
      expect(lower.endX).toBe(upper.endX);
      expect(lower.endY).toBe(upper.endY);
      expect(lower.endX).toBe(mixed.endX);
      expect(lower.endY).toBe(mixed.endY);
    });
  });

  // ── Largest face fallback ───────────────────────────────────────────
  describe('largest face fallback', () => {
    it('picks largest face when no focusPerson specified', () => {
      const smallFace = makeFace({ centerX: 0.2, centerY: 0.2, width: 50, height: 50 });
      const bigFace   = makeFace({ centerX: 0.7, centerY: 0.6, width: 200, height: 200 });
      const people = [
        makePerson('Small', [smallFace]),
        makePerson('Big',   [bigFace]),
      ];

      const result = computeZoomTarget({ people, focusPerson: null, zoom: defaultZoom });

      expect(result.strategy).toBe('largest-face');

      // Should zoom toward Big's face at (0.7, 0.6)
      const maxTranslate = ((defaultZoom - 1) / defaultZoom) * 50;
      const expectedEndX = (0.5 - 0.7) * maxTranslate;
      const expectedEndY = (0.5 - 0.6) * maxTranslate;
      expect(pct(result.endX)).toBeCloseTo(expectedEndX, 1);
      expect(pct(result.endY)).toBeCloseTo(expectedEndY, 1);
    });

    it('picks largest face when focusPerson does not match anyone', () => {
      const face = makeFace({ centerX: 0.6, centerY: 0.4, width: 150, height: 150 });
      const people = [makePerson('Charlie', [face])];

      const result = computeZoomTarget({
        people,
        focusPerson: 'NonExistent',
        zoom: defaultZoom,
      });

      expect(result.strategy).toBe('largest-face');

      const maxTranslate = ((defaultZoom - 1) / defaultZoom) * 50;
      const expectedEndX = (0.5 - 0.6) * maxTranslate;
      const expectedEndY = (0.5 - 0.4) * maxTranslate;
      expect(pct(result.endX)).toBeCloseTo(expectedEndX, 1);
      expect(pct(result.endY)).toBeCloseTo(expectedEndY, 1);
    });

    it('selects correctly among multiple faces on one person', () => {
      const smallFace = makeFace({ centerX: 0.3, centerY: 0.3, width: 40, height: 40 });
      const bigFace   = makeFace({ centerX: 0.8, centerY: 0.8, width: 300, height: 300 });
      const people = [makePerson('Multi', [smallFace, bigFace])];

      const result = computeZoomTarget({ people, focusPerson: null, zoom: defaultZoom });
      expect(result.strategy).toBe('largest-face');

      const maxTranslate = ((defaultZoom - 1) / defaultZoom) * 50;
      const expectedEndX = (0.5 - 0.8) * maxTranslate;
      expect(pct(result.endX)).toBeCloseTo(expectedEndX, 1);
    });
  });

  // ── Random fallback ─────────────────────────────────────────────────
  describe('random fallback', () => {
    it('returns valid percentages when no faces', () => {
      const result = computeZoomTarget({ people: [], focusPerson: null, zoom: defaultZoom });

      expect(result.strategy).toBe('random');
      // The percentage strings should be parseable
      expect(result.startX).toMatch(/^-?\d+(\.\d+)?%$/);
      expect(result.startY).toMatch(/^-?\d+(\.\d+)?%$/);
      expect(result.endX).toMatch(/^-?\d+(\.\d+)?%$/);
      expect(result.endY).toMatch(/^-?\d+(\.\d+)?%$/);
    });

    it('random target stays within center 60% of image (0.2–0.8)', () => {
      // Run many iterations to verify the random range is bounded
      for (let i = 0; i < 100; i++) {
        const result = computeZoomTarget({ people: [], focusPerson: null, zoom: defaultZoom });
        expect(result.strategy).toBe('random');

        // Reverse-engineer targetX/targetY from the end offsets:
        //   endOff = (0.5 - target) * maxTranslate
        //   target = 0.5 - endOff / maxTranslate
        const maxTranslate = ((defaultZoom - 1) / defaultZoom) * 50;
        const targetX = 0.5 - pct(result.endX) / maxTranslate;
        const targetY = 0.5 - pct(result.endY) / maxTranslate;

        expect(targetX).toBeGreaterThanOrEqual(0.2 - 0.001);
        expect(targetX).toBeLessThanOrEqual(0.8 + 0.001);
        expect(targetY).toBeGreaterThanOrEqual(0.2 - 0.001);
        expect(targetY).toBeLessThanOrEqual(0.8 + 0.001);
      }
    });

    it('handles null people', () => {
      const result = computeZoomTarget({ people: null, focusPerson: null, zoom: defaultZoom });
      expect(result.strategy).toBe('random');
      expect(result.endX).toMatch(/^-?\d+(\.\d+)?%$/);
    });

    it('handles undefined people', () => {
      const result = computeZoomTarget({ people: undefined, focusPerson: null, zoom: defaultZoom });
      expect(result.strategy).toBe('random');
    });

    it('handles people with empty faces arrays', () => {
      const people = [
        makePerson('NoFace', []),
        makePerson('AlsoNoFace', []),
      ];
      const result = computeZoomTarget({ people, focusPerson: null, zoom: defaultZoom });
      expect(result.strategy).toBe('random');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles faces with missing imageWidth/imageHeight', () => {
      // Face without imageWidth/imageHeight should cause fallback
      const brokenFace = { x1: 100, y1: 100, x2: 200, y2: 200 };
      const people = [makePerson('Broken', [brokenFace])];

      const result = computeZoomTarget({ people, focusPerson: 'Broken', zoom: defaultZoom });
      // focusPerson match has no imageWidth so it falls through
      // largest-face also lacks imageWidth so it falls through to random
      expect(result.strategy).toBe('random');
    });

    it('falls through focusPerson to largest-face when good face has bigger area', () => {
      // Broken face: no imageWidth/imageHeight, area = 100*100 = 10000
      const brokenFace = { x1: 100, y1: 100, x2: 200, y2: 200 };
      // Good face: has dimensions, area must be LARGER than broken so it wins the loop
      const goodFace = makeFace({ centerX: 0.5, centerY: 0.5, width: 200, height: 200 });
      const people = [
        makePerson('Broken', [brokenFace]),
        makePerson('Good',   [goodFace]),
      ];

      const result = computeZoomTarget({ people, focusPerson: 'Broken', zoom: defaultZoom });
      // focusPerson matches "Broken" but it lacks imageWidth, so found stays false.
      // largest-face loop: good face (200x200=40000) beats broken face (100x100=10000),
      // and good face has imageWidth/imageHeight, so it succeeds.
      expect(result.strategy).toBe('largest-face');
    });

    it('falls to random when largest face also lacks dimensions', () => {
      // Both faces lack imageWidth/imageHeight
      const brokenA = { x1: 100, y1: 100, x2: 300, y2: 300 };
      const brokenB = { x1: 50, y1: 50, x2: 150, y2: 150 };
      const people = [
        makePerson('A', [brokenA]),
        makePerson('B', [brokenB]),
      ];

      const result = computeZoomTarget({ people, focusPerson: null, zoom: defaultZoom });
      // largest-face picks brokenA (largest area) but it lacks imageWidth, so falls to random
      expect(result.strategy).toBe('random');
    });

    it('startX/startY are 30% of endX/endY (slow-start parallax)', () => {
      const alice = makePerson('Alice', [makeFace({ centerX: 0.3, centerY: 0.4 })]);
      const result = computeZoomTarget({ people: [alice], focusPerson: 'Alice', zoom: defaultZoom });

      // start offsets should be exactly 0.3 * end offsets
      const startX = pct(result.startX);
      const endX   = pct(result.endX);
      const startY = pct(result.startY);
      const endY   = pct(result.endY);

      // Precision limited to 2 due to .toFixed(2) in output strings
      expect(startX).toBeCloseTo(endX * 0.3, 2);
      expect(startY).toBeCloseTo(endY * 0.3, 2);
    });

    it('produces zero translation when target is dead center (0.5, 0.5)', () => {
      const center = makePerson('Center', [makeFace({ centerX: 0.5, centerY: 0.5 })]);
      const result = computeZoomTarget({ people: [center], focusPerson: 'Center', zoom: defaultZoom });

      expect(result.strategy).toBe('focus-person');
      expect(pct(result.startX)).toBeCloseTo(0, 5);
      expect(pct(result.startY)).toBeCloseTo(0, 5);
      expect(pct(result.endX)).toBeCloseTo(0, 5);
      expect(pct(result.endY)).toBeCloseTo(0, 5);
    });

    it('handles zoom of exactly 1 (no scaling — maxTranslate is 0)', () => {
      const alice = makePerson('Alice', [makeFace({ centerX: 0.3, centerY: 0.4 })]);
      const result = computeZoomTarget({ people: [alice], focusPerson: 'Alice', zoom: 1 });

      expect(result.strategy).toBe('focus-person');
      // maxTranslate = ((1-1)/1)*50 = 0, so all offsets are 0
      expect(pct(result.startX)).toBe(0);
      expect(pct(result.startY)).toBe(0);
      expect(pct(result.endX)).toBe(0);
      expect(pct(result.endY)).toBe(0);
    });

    it('handles large zoom values', () => {
      const alice = makePerson('Alice', [makeFace({ centerX: 0.2, centerY: 0.8 })]);
      const result = computeZoomTarget({ people: [alice], focusPerson: 'Alice', zoom: 3.0 });

      expect(result.strategy).toBe('focus-person');
      // maxTranslate = ((3-1)/3)*50 = 33.33...
      const maxTranslate = ((3 - 1) / 3) * 50;
      const expectedEndX = (0.5 - 0.2) * maxTranslate;
      const expectedEndY = (0.5 - 0.8) * maxTranslate;
      expect(pct(result.endX)).toBeCloseTo(expectedEndX, 1);
      expect(pct(result.endY)).toBeCloseTo(expectedEndY, 1);
    });

    it('person with no name does not match focusPerson', () => {
      const nameless = { name: null, faces: [makeFace({ centerX: 0.3, centerY: 0.3 })] };
      const result = computeZoomTarget({
        people: [nameless],
        focusPerson: 'Alice',
        zoom: defaultZoom,
      });

      // focusPerson "Alice" won't match null name, falls to largest-face
      expect(result.strategy).toBe('largest-face');
    });
  });
});
