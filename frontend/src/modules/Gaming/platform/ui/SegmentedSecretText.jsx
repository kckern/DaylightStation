import React, { useEffect, useRef } from 'react';
import { getChildLogger } from '../../../../lib/logging/singleton.js';
import { SEGMENTS, SEGMENT_NEIGHBORS, activeSegmentsFor, segmentNames, segmentPoints } from './segmentedSecretGeometry.js';
import { MASK_SEGMENT_COLORS, SIGNAL_SEGMENT_COLORS, segmentColorValue } from './segmentedSecretPalette.js';
import { FLICKER_GROUP_COUNT, FLICKER_TICK_MS, assignFlickerGroups, nextColorIndex } from './segmentFlicker.js';
import { SECRET_TEXT_MOTION_MS, generateSecretTextMotion } from './segmentedSecretMotion.js';
import './SegmentedSecretText.scss';

// A physical red decoder filter preserves the warm signal segments while
// substantially dimming the cool mask segments. Every cell stays filled so
// whitespace cannot reveal a word boundary without the decoder. Colors keep
// changing within each family so the warm/cool split is hard to sort by eye;
// a change never moves a segment across families, so the filtered view holds.
const SIGNAL_COLORS = Object.freeze(SIGNAL_SEGMENT_COLORS.map(segmentColorValue));
const MASK_COLORS = Object.freeze(MASK_SEGMENT_COLORS.map(segmentColorValue));
const TARGET_LINE_LENGTH = 18;

let _logger;
function logger() {
  if (!_logger) _logger = getChildLogger({ component: 'segmented-secret-text' });
  return _logger;
}

function colorIndex(seed, glyphIndex, segmentName, paletteLength) {
  let hash = 2166136261;
  for (const character of `${seed}:${segmentName}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + glyphIndex) % paletteLength;
}

export function balanceSecretLines(text, targetLength = TARGET_LINE_LENGTH) {
  const value = String(text || '');
  const lineCount = Math.max(1, Math.ceil(value.length / targetLength));
  if (lineCount === 1) return [value];

  const lines = [];
  let start = 0;
  for (let line = 0; line < lineCount - 1; line += 1) {
    const remainingLines = lineCount - line;
    const idealBreak = start + (value.length - start) / remainingLines;
    const wordBreaks = [...value].flatMap((character, index) => (
      character === ' ' && index >= start ? [index + 1] : []
    ));
    const candidates = wordBreaks.filter(index => index > start && index < value.length);
    const end = candidates.length > 0
      ? candidates.reduce((best, candidate) => (
        Math.abs(candidate - idealBreak) < Math.abs(best - idealBreak) ? candidate : best
      ))
      : Math.min(value.length, start + targetLength);
    lines.push(value.slice(start, end));
    start = end;
  }
  lines.push(value.slice(start));
  return lines.map(line => line.trim());
}

// Writes colors straight to the polygons' custom property: a tick restyles a
// third of the display, which would otherwise re-render every glyph 3x/second.
function useSegmentFlicker(rootRef, value) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const segments = [...root.querySelectorAll('polygon')].map((element) => {
      const palette = element.classList.contains('is-signal') ? SIGNAL_COLORS : MASK_COLORS;
      let index = palette.indexOf(element.style.getPropertyValue('--segment-color'));
      // A reused polygon can still hold a flickered color from the previous clue
      // in the other family; never let it start there.
      if (index < 0) {
        index = 0;
        element.style.setProperty('--segment-color', palette[index]);
      }
      return { element, palette, index, neighbors: [] };
    });
    // Touching letter segments of the same glyph, so a change can steer clear
    // of their colors. Only letters are guarded; mask segments may match.
    const byGlyph = new Map();
    for (const segment of segments) {
      const glyph = segment.element.parentNode;
      if (!byGlyph.has(glyph)) byGlyph.set(glyph, []);
      byGlyph.get(glyph).push(segment);
    }
    for (const glyphSegments of byGlyph.values()) {
      const signal = glyphSegments.filter(segment => segment.element.classList.contains('is-signal'));
      for (const segment of signal) {
        const touching = SEGMENT_NEIGHBORS[segment.element.dataset.segment] ?? [];
        segment.neighbors = signal.filter(other => other !== segment && touching.includes(other.element.dataset.segment));
      }
    }
    const avoidFor = segment => segment.neighbors.map(other => other.index);
    // A polygon reused from the previous clue can keep a flickered color that
    // now matches a touching segment; repair it before the first tick.
    for (const segment of segments) {
      if (!segment.neighbors.some(other => other.index === segment.index)) continue;
      segment.index = nextColorIndex(segment.index, segment.palette.length, Math.random, avoidFor(segment));
      segment.element.style.setProperty('--segment-color', segment.palette[segment.index]);
    }
    const groups = assignFlickerGroups(segments.length);
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let tick = 0;
    let timer = null;
    const step = () => {
      if (document.visibilityState === 'hidden') return;
      for (const segmentIndex of groups[tick % FLICKER_GROUP_COUNT]) {
        const segment = segments[segmentIndex];
        segment.index = nextColorIndex(segment.index, segment.palette.length, Math.random, avoidFor(segment));
        segment.element.style.setProperty('--segment-color', segment.palette[segment.index]);
      }
      tick += 1;
    };
    const sync = () => {
      const reducedMotion = Boolean(motionQuery?.matches);
      if (reducedMotion && timer) {
        clearInterval(timer);
        timer = null;
      } else if (!reducedMotion && !timer) {
        timer = setInterval(step, FLICKER_TICK_MS);
      }
      logger().debug('gaming.segmented-secret.flicker', { running: Boolean(timer), reducedMotion, segments: segments.length });
    };
    sync();
    motionQuery?.addEventListener?.('change', sync);
    return () => {
      if (timer) clearInterval(timer);
      motionQuery?.removeEventListener?.('change', sync);
    };
  }, [rootRef, value]);
}

// Moves the whole card the way ImageDecoderDisplay does: a new seeded offset
// every second, jumping to the opposite edge each time, so staring and
// squinting never holds a steady image long enough to resolve the letters.
// Written straight to the root like the flicker, so a tick never re-renders
// the glyphs.
function useSecretTextMotion(rootRef, value, intervalMs) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const frames = generateSecretTextMotion(value);
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let index = 0;
    let timer = null;
    const place = () => {
      const frame = frames[index];
      root.style.transform = `translate3d(${frame.x.toFixed(2)}%, ${frame.y.toFixed(2)}%, 0)`;
      root.dataset.motionIndex = String(index);
    };
    const step = () => {
      if (document.visibilityState === 'hidden') return;
      index = (index + 1) % frames.length;
      place();
    };
    const sync = () => {
      const still = Boolean(motionQuery?.matches) || !Number.isFinite(intervalMs) || intervalMs <= 0;
      if (still) {
        if (timer) clearInterval(timer);
        timer = null;
        index = 0;
        root.style.transform = '';
        root.dataset.motionIndex = '0';
      } else if (!timer) {
        place();
        timer = setInterval(step, intervalMs);
      }
      logger().debug('gaming.segmented-secret.motion', { running: Boolean(timer), intervalMs, frames: frames.length });
    };
    sync();
    motionQuery?.addEventListener?.('change', sync);
    return () => {
      if (timer) clearInterval(timer);
      motionQuery?.removeEventListener?.('change', sync);
    };
  }, [rootRef, value, intervalMs]);
}

function Glyph({ character, index, seed }) {
  const active = new Set(activeSegmentsFor(character));
  // Touching letter segments never start on the same color: each takes its
  // hashed color, stepping past any a touching segment already holds.
  const signalColor = {};
  segmentNames.forEach((name, segmentIndex) => {
    if (!active.has(name)) return;
    const taken = new Set(SEGMENT_NEIGHBORS[name].filter(other => other in signalColor).map(other => signalColor[other]));
    let color = colorIndex(seed, index, `signal:${name}:${segmentIndex}`, SIGNAL_COLORS.length);
    for (let tries = 0; taken.has(color) && tries < SIGNAL_COLORS.length; tries += 1) {
      color = (color + 1) % SIGNAL_COLORS.length;
    }
    signalColor[name] = color;
  });
  return (
    <svg className="segmented-secret-text__glyph" viewBox="0 0 50 100" aria-hidden="true">
      {segmentNames.map((name, segmentIndex) => {
        const isSignal = active.has(name);
        const palette = isSignal ? SIGNAL_COLORS : MASK_COLORS;
        const color = isSignal ? signalColor[name] : colorIndex(seed, index, `mask:${name}:${segmentIndex}`, palette.length);
        return <polygon key={name} points={segmentPoints(SEGMENTS[name])}
          className={isSignal ? 'is-signal' : 'is-mask'}
          data-segment={name}
          style={{ '--segment-color': palette[color] }} />;
      })}
    </svg>
  );
}

export default function SegmentedSecretText({
  text, label = 'Secret clue', accessibleText = null, motionIntervalMs = SECRET_TEXT_MOTION_MS,
}) {
  const rootRef = useRef(null);
  const value = String(text || '').toUpperCase();
  const lines = balanceSecretLines(value);
  useSegmentFlicker(rootRef, value);
  useSecretTextMotion(rootRef, value, motionIntervalMs);
  let glyphIndex = 0;
  return (
    <div ref={rootRef} className="segmented-secret-text" role="img" aria-label={accessibleText || `${label}: ${value}`}>
      {lines.map((line, lineIndex) => (
        <span className="segmented-secret-text__line" key={`${lineIndex}:${line}`}>
          {[...line].map(character => {
            const index = glyphIndex;
            glyphIndex += 1;
            return <Glyph key={index} character={character} index={index} seed={value} />;
          })}
        </span>
      ))}
    </div>
  );
}
