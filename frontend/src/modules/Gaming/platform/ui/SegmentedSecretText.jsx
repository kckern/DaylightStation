import React, { memo, useLayoutEffect, useRef } from 'react';
import { getChildLogger } from '../../../../lib/logging/singleton.js';
import { SEGMENTS, SEGMENT_NEIGHBORS, activeSegmentsFor, segmentNames, segmentPoints } from './segmentedSecretGeometry.js';
import { MASK_SEGMENT_COLORS, SIGNAL_SEGMENT_COLORS, segmentColorValue } from './segmentedSecretPalette.js';
import { nextColorIndex } from './segmentFlicker.js';
import { generateSecretTextMotion } from './segmentedSecretMotion.js';
import { CURSOR_SEGMENTS, decoderSettings, revealFrame } from './segmentedSecretReveal.js';
import './SegmentedSecretText.scss';

// A physical red decoder filter preserves the warm signal segments while
// substantially dimming the cool mask segments. Every cell stays filled so
// whitespace cannot reveal a word boundary without the decoder. Colors keep
// changing within each family so the warm/cool split is hard to sort by eye;
// a change never moves a segment across families, so the filtered view holds.
const SIGNAL_COLORS = Object.freeze(SIGNAL_SEGMENT_COLORS.map(segmentColorValue));
const MASK_COLORS = Object.freeze(MASK_SEGMENT_COLORS.map(segmentColorValue));
const TARGET_LINE_LENGTH = 18;
const CURSOR = new Set(CURSOR_SEGMENTS);
const NOTHING = new Set();
const STATIC = decoderSettings({ reveal: 'static' });

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

// THE DECODER ENGINE. One clock, `stepMs` per step. Each step it works out
// which letters show (`revealFrame`: progressive typing, a marquee, or all of
// it), lights those letters' segments warm and everything else cool, and gives
// every segment a new color; every `motionMs` it also jumps the card to its
// next seeded position (alternating edges, following ImageDecoderDisplay).
//
// A layout effect, not a plain one: the first frame — nothing showing but the
// cursor — must be on screen before the browser paints, or the whole clue
// flashes up for a frame. Everything is written straight to the DOM, so a step
// never re-renders the glyphs.
function useDecoderEngine(rootRef, value, settings) {
  const settingsKey = JSON.stringify(settings);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const lines = balanceSecretLines(value);
    const cells = [...root.querySelectorAll('.segmented-secret-text__glyph')].map((glyph) => {
      const polygons = [...glyph.querySelectorAll('polygon')].map((element) => {
        const signal = element.classList.contains('is-signal');
        const palette = signal ? SIGNAL_COLORS : MASK_COLORS;
        return { element, name: element.dataset.segment, signal, index: palette.indexOf(element.style.getPropertyValue('--segment-color')) };
      });
      return {
        polygons,
        byName: Object.fromEntries(polygons.map(polygon => [polygon.name, polygon])),
      };
    });
    // The segments of whichever character a frame puts in a cell. In a marquee
    // that is rarely the cell's own character, so it is looked up per frame.
    const letters = new Map();
    const segmentsOf = (character) => {
      if (!letters.has(character)) letters.set(character, new Set(activeSegmentsFor(character)));
      return letters.get(character);
    };
    const positions = generateSecretTextMotion(value);
    const motionEvery = Math.max(1, Math.round(settings.motionMs / settings.stepMs));
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let step = 0;
    let timer = null;

    // Light each cell for the frame, then recolor every segment in order: in its
    // own family, never the color it just held, and never a color a touching lit
    // letter segment holds right now (later segments see earlier ones' new colors).
    const paint = (frame) => {
      const flat = frame.flat();
      cells.forEach((cell, cellIndex) => {
        const shown = flat[cellIndex] ?? { char: null, cursor: false };
        const lit = shown.char != null ? segmentsOf(shown.char) : shown.cursor ? CURSOR : NOTHING;
        for (const polygon of cell.polygons) {
          const signal = lit.has(polygon.name);
          if (signal !== polygon.signal) {
            polygon.signal = signal;
            polygon.index = -1;
            polygon.element.classList.toggle('is-signal', signal);
            polygon.element.classList.toggle('is-mask', !signal);
          }
        }
        for (const polygon of cell.polygons) {
          const palette = polygon.signal ? SIGNAL_COLORS : MASK_COLORS;
          const avoid = polygon.signal
            ? SEGMENT_NEIGHBORS[polygon.name].map(name => cell.byName[name])
              .filter(other => other?.signal && other.index >= 0).map(other => other.index)
            : [];
          polygon.index = nextColorIndex(polygon.index, palette.length, Math.random, avoid);
          polygon.element.style.setProperty('--segment-color', palette[polygon.index]);
        }
      });
    };
    const place = () => {
      if (!settings.motion) {
        root.style.transform = '';
        root.dataset.motionIndex = '0';
        return;
      }
      const index = Math.floor(step / motionEvery) % positions.length;
      const offset = positions[index];
      root.style.transform = `translate3d(${offset.x.toFixed(2)}%, ${offset.y.toFixed(2)}%, 0)`;
      root.dataset.motionIndex = String(index);
    };
    const show = () => {
      root.dataset.revealStep = String(step);
      paint(revealFrame(lines, step, settings));
      place();
    };
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      step += 1;
      show();
    };
    const sync = () => {
      if (motionQuery?.matches) {
        // Reduced motion: the whole clue, centred and still.
        if (timer) clearInterval(timer);
        timer = null;
        step = 0;
        root.dataset.revealStep = '0';
        paint(revealFrame(lines, 0, STATIC));
        root.style.transform = '';
        root.dataset.motionIndex = '0';
      } else if (!timer) {
        show();
        timer = setInterval(tick, settings.stepMs);
      }
      logger().debug('gaming.segmented-secret.engine', {
        running: Boolean(timer), reveal: settings.reveal, stepMs: settings.stepMs,
        motion: settings.motion, motionMs: settings.motionMs, cells: cells.length,
      });
    };
    sync();
    motionQuery?.addEventListener?.('change', sync);
    return () => {
      if (timer) clearInterval(timer);
      motionQuery?.removeEventListener?.('change', sync);
    };
  }, [rootRef, value, settingsKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Drawn as the true letter; the engine takes over before the first paint.
const Glyph = memo(function Glyph({ character, index, seed }) {
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
    <svg className="segmented-secret-text__glyph" viewBox="0 0 50 100" aria-hidden="true" data-char={character}>
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
});

/**
 * @param {object} props
 * @param {string} props.text
 * @param {object|null} [props.decoder] a game's `decoder:` settings block
 *   (`reveal`, `step_ms`, `motion`, `motion_ms`, `marquee_hold_steps`,
 *   `marquee_gap_steps`); anything missing takes its default — see
 *   `DECODER_DEFAULTS` in segmentedSecretReveal.js.
 */
export default function SegmentedSecretText({ text, label = 'Secret clue', accessibleText = null, decoder = null }) {
  const rootRef = useRef(null);
  const value = String(text || '').toUpperCase();
  const lines = balanceSecretLines(value);
  const settings = decoderSettings(decoder);
  useDecoderEngine(rootRef, value, settings);
  let glyphIndex = 0;
  return (
    <div ref={rootRef} className="segmented-secret-text" role="img" aria-label={accessibleText || `${label}: ${value}`} data-reveal={settings.reveal}>
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
