import {
  glyphAdvance,
  glyphDescenderRow,
  glyphRows,
  loadSchoolCalcUiAssets,
} from './schoolcalc-ui-assets.mjs';

export const TI86_SCREEN_WIDTH = 128;
export const TI86_SCREEN_HEIGHT = 64;
export const TI86_SCREEN_PIXELS = TI86_SCREEN_WIDTH * TI86_SCREEN_HEIGHT;
export const TI86_SCREEN_BYTES = TI86_SCREEN_PIXELS / 8;

/**
 * Decode a SchoolCalc framebuffer without assuming a grid origin.
 *
 * Every declared font glyph is swept across every legal `(x,y)` position in
 * both drawing modes.  Recognised glyph pixels are then consumed before a
 * separate Braille pass renders the remaining dark, non-chrome pixels.
 */
export function decodeTi86Screen(pixels, { assets = loadSchoolCalcUiAssets(), stripChrome = true } = {}) {
  const bitmap = framebufferPixels(pixels);
  // QR is a full-frame interaction mode, not a field of text. Recognizing
  // its fixed finder geometry first avoids mistaking data modules for stray
  // font glyphs (for example a faux "2 A E" in a result QR transcript).
  const qr = detectQrPresentation(bitmap);
  // Prose is the primary semantic signal.  A tiny icon or availability
  // template can happen to match in a letter's whitespace; claiming it first
  // fragments the otherwise exact text run (for example "DRAGONAIR" could
  // become "AIR").  QR is the deliberate exception: its fixed module field
  // owns that rectangle before any text sweep begins.
  const reserved = qr ? [qr] : [];
  // A QR owns its module rectangle, not the whole LCD. Continue the glyph
  // sweep around that rectangle so a result presenter can expose sparse rail
  // labels such as DONE/LATER without decoding QR modules as text.
  const candidates = findGlyphCandidates(bitmap, assets);
  const text = selectTextRuns(candidates, reserved);
  const symbols = qr ? reserved : selectSemanticSymbols(findSemanticCandidates(bitmap, assets), text);
  const consumed = new Uint8Array(TI86_SCREEN_PIXELS);
  for (const symbol of symbols) {
    for (const pixel of symbol.inkPixels) consumed[pixel] = 1;
  }
  for (const run of text) {
    for (const glyph of run.glyphs) {
      for (const pixel of glyph.inkPixels) consumed[pixel] = 1;
    }
  }
  const chrome = stripChrome ? detectChrome(bitmap) : new Uint8Array(TI86_SCREEN_PIXELS);
  return Object.freeze({
    qr: qr ? Object.freeze({ ...qr, inkPixels: Object.freeze([...qr.inkPixels]), footprint: Object.freeze([...qr.footprint]) }) : null,
    symbols: Object.freeze(symbols.map(freezeSymbol)),
    text: Object.freeze(text.map(freezeRun)),
    braille: renderBraille(bitmap, { consumed, chrome }),
    compactBraille: renderBraille(bitmap, { consumed, chrome, sourceRowsPerDot: 2 }),
    consumed,
    chrome,
  });
}

/** Render text locations/polarities plus the non-text graphical remainder. */
export function renderTi86ScreenHybrid(pixels, options = {}) {
  const decoded = decodeTi86Screen(pixels, options);
  const text = decoded.text.length === 0 ? '[none]' : decoded.text
    .map((run) => `(${run.x},${run.y})${polarityMark(run.polarity)}/${fontMark(run.font)}:${run.text}`)
    .join(' | ');
  const symbols = decoded.symbols.length === 0 ? '[none]' : decoded.symbols
    .map((symbol) => `(${symbol.x},${symbol.y})${polarityMark(symbol.polarity)}:${symbol.symbol}`)
    .join(' ');
  // A screen label from the CLI + these ten lines = at most eleven terminal
  // rows: one semantic text line, one legend, and eight 2×8 Braille rows.
  const lines = [
    `T ${text}; S ${symbols}`,
    'G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; k/c/r/d = code/compact/reader/display.',
    ...decoded.compactBraille.split('\n'),
  ];
  return `${lines.join('\n')}\n`;
}

/** Render only recognised text, retaining its actual origin and polarity. */
export function renderTi86ScreenText(pixels, options = {}) {
  const decoded = decodeTi86Screen(pixels, options);
  const text = decoded.text.length === 0 ? '[none]' : decoded.text
    .map((run) => `(${run.x},${run.y})${polarityMark(run.polarity)}/${fontMark(run.font)}:${run.text}`).join(' | ');
  const symbols = decoded.symbols.length === 0 ? '[none]' : decoded.symbols
    .map((symbol) => `(${symbol.x},${symbol.y})${polarityMark(symbol.polarity)}:${symbol.symbol}`).join(' ');
  return `T ${text}; S ${symbols}\n`;
}

/** Render only the unconsumed graphical remainder as 64 × 16 Braille cells. */
export function renderTi86ScreenBraille(pixels, { fullResolution = false, ...options } = {}) {
  const decoded = decodeTi86Screen(pixels, options);
  return `${fullResolution ? decoded.braille : decoded.compactBraille}\n`;
}

function framebufferPixels(pixels) {
  const bytes = Buffer.from(pixels ?? []);
  if (bytes.length !== TI86_SCREEN_BYTES) {
    throw new Error(`TI-86 framebuffer must be ${TI86_SCREEN_BYTES} bytes`);
  }
  const bitmap = new Uint8Array(TI86_SCREEN_PIXELS);
  for (let y = 0; y < TI86_SCREEN_HEIGHT; y += 1) {
    for (let x = 0; x < TI86_SCREEN_WIDTH; x += 1) {
      bitmap[indexOf(x, y)] = (bytes[(y * 16) + (x >>> 3)] & (0x80 >>> (x & 7))) ? 1 : 0;
    }
  }
  return bitmap;
}

function findGlyphCandidates(bitmap, assets) {
  const candidates = [];
  for (const font of assets.fonts.values()) {
    const templates = buildTemplates(font);
    for (const template of templates) {
      for (const polarity of ['dark-on-light', 'light-on-dark']) {
        // Inverse text is used for title/action/selection labels, all of
        // which are alphanumeric.  Sparse inverse punctuation can otherwise
        // match the edge of a solid selection band (for example `_`).
        // A compact inverse question counter (Q1/3) and the explicit F1=A
        // rail are semantic text, not decorative chrome. Their punctuation
        // is safe once the dark-backdrop check below has confirmed a real
        // header or function cell.
        if (polarity === 'light-on-dark' && !/^[A-Za-z0-9/=]$/.test(template.character)) continue;
        for (let y = 0; y <= TI86_SCREEN_HEIGHT - template.height; y += 1) {
          for (let x = 0; x <= TI86_SCREEN_WIDTH - template.width; x += 1) {
            if (matchesTemplate(bitmap, x, y, template, polarity)) {
              // An inverse glyph belongs on a dark header, selection, or
              // function rail. Without a dark perimeter, a few normal glyph
              // strokes can accidentally satisfy the inverse template and
              // then steal pixels from the real text run.
              if (polarity === 'light-on-dark' && !hasInverseBackdrop(bitmap, x, y, template)) continue;
              candidates.push({
                font: font.id,
                x,
                y,
                polarity,
                character: template.character,
                alternatives: template.alternatives,
                advance: template.advance,
                inkPixels: template.inkPixels.map(({ x: offsetX, y: offsetY }) => indexOf(x + offsetX, y + offsetY)),
                footprint: template.footprint.map(({ x: offsetX, y: offsetY }) => indexOf(x + offsetX, y + offsetY)),
              });
            }
          }
        }
      }
    }
  }
  return candidates;
}

function findSemanticCandidates(bitmap, assets) {
  const candidates = [];
  for (const icon of assets.icons) {
    const template = iconTemplate(icon);
    candidates.push(...sweepTemplate(bitmap, template, {
      kind: `icon:${icon.id}`,
      symbol: iconSymbol(icon.id),
      priority: 30,
    }));
  }
  for (const template of circleTemplates()) {
    candidates.push(...sweepTemplate(bitmap, template, {
      kind: template.kind,
      symbol: template.symbol,
      priority: 20,
    }));
  }
  const compact = assets.fonts.get('compact-3x5');
  for (const [character, symbol] of Object.entries({
    '>': '❯', '<': '❮', '*': '●', '+': '○', '~': '◌', '^': '◐', '!': '!',
  })) {
    candidates.push(...sweepTemplate(bitmap, buildTemplate(compact, character), {
      kind: `compact:${character}`,
      symbol,
      priority: 10,
    }));
  }
  return candidates;
}

function iconTemplate(icon) {
  const footprint = [];
  const inkPixels = [];
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const filled = (icon.bytes[y] & (0x80 >>> x)) !== 0;
      footprint.push({ x, y, filled });
      if (filled) inkPixels.push({ x, y });
    }
  }
  return { width: 7, height: 7, footprint, inkPixels };
}

function circleTemplates() {
  return [
    bitmapTemplate('availability-remote', '○', ['.██.', '█..█', '█..█', '.██.']),
    bitmapTemplate('availability-installed', '●', ['.██.', '████', '████', '.██.']),
  ];
}

// Both QR profiles are intentionally fixed on the TI-86. Result transfer is
// Version 5/M at native LCD pixels; lesson actions are Version 1/L with
// double-size modules. Three exact finder patterns identify the semantic
// surface without attempting to decode its opaque payload in the screen tool.
const QR_PROFILES = Object.freeze([
  Object.freeze({ label: '▦ QR V5/M 37×37', x: 45, y: 13, modules: 37, scale: 1 }),
  Object.freeze({ label: '▦ QR V1/L 21×21 ×2', x: 43, y: 11, modules: 21, scale: 2 }),
]);

function detectQrPresentation(bitmap) {
  for (const profile of QR_PROFILES) {
    const offset = (profile.modules - 7) * profile.scale;
    const finders = [[profile.x, profile.y], [profile.x + offset, profile.y], [profile.x, profile.y + offset]];
    if (!finders.every(([x, y]) => matchesQrFinder(bitmap, x, y, profile.scale))) continue;
    const inkPixels = [];
    const footprint = [];
    for (let y = profile.y; y < profile.y + profile.modules * profile.scale; y += 1) {
      for (let x = profile.x; x < profile.x + profile.modules * profile.scale; x += 1) {
        const pixel = indexOf(x, y);
        footprint.push(pixel);
        if (bitmap[pixel]) inkPixels.push(pixel);
      }
    }
    return {
      kind: 'qr', symbol: profile.label, x: profile.x, y: profile.y,
      polarity: 'dark-on-light', inkPixels, footprint,
    };
  }
  return null;
}

function matchesQrFinder(bitmap, originX, originY, scale) {
  for (let moduleY = 0; moduleY < 7; moduleY += 1) {
    for (let moduleX = 0; moduleX < 7; moduleX += 1) {
      const dark = moduleX === 0 || moduleX === 6 || moduleY === 0 || moduleY === 6
        || (moduleX >= 2 && moduleX <= 4 && moduleY >= 2 && moduleY <= 4);
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          if (bitmap[indexOf(originX + moduleX * scale + dx, originY + moduleY * scale + dy)] !== Number(dark)) return false;
        }
      }
    }
  }
  return true;
}

function bitmapTemplate(kind, symbol, rows) {
  const footprint = [];
  const inkPixels = [];
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      const filled = rows[y][x] === '█';
      footprint.push({ x, y, filled });
      if (filled) inkPixels.push({ x, y });
    }
  }
  return { kind, symbol, width: rows[0].length, height: rows.length, footprint, inkPixels };
}

function sweepTemplate(bitmap, template, details) {
  const matches = [];
  for (const polarity of ['dark-on-light', 'light-on-dark']) {
    for (let y = 0; y <= TI86_SCREEN_HEIGHT - template.height; y += 1) {
      for (let x = 0; x <= TI86_SCREEN_WIDTH - template.width; x += 1) {
        if (!matchesTemplate(bitmap, x, y, template, polarity)) continue;
        matches.push({
          ...details,
          x,
          y,
          polarity,
          inkPixels: template.inkPixels.map(({ x: offsetX, y: offsetY }) => indexOf(x + offsetX, y + offsetY)),
          footprint: template.footprint.map(({ x: offsetX, y: offsetY }) => indexOf(x + offsetX, y + offsetY)),
        });
      }
    }
  }
  return matches;
}

function selectSemanticSymbols(candidates, preclaimedText = []) {
  const claimed = new Uint8Array(TI86_SCREEN_PIXELS);
  for (const run of preclaimedText) {
    for (const glyph of run.glyphs) {
      for (const pixel of glyph.footprint) claimed[pixel] = 1;
    }
  }
  const selected = [];
  candidates.sort((left, right) => right.priority - left.priority || left.y - right.y || left.x - right.x);
  for (const candidate of candidates) {
    if (candidate.footprint.some((pixel) => claimed[pixel])) continue;
    for (const pixel of candidate.footprint) claimed[pixel] = 1;
    selected.push(candidate);
  }
  return selected.sort((left, right) => left.y - right.y || left.x - right.x);
}

function buildTemplates(font) {
  const groups = new Map();
  for (const character of font.characters ?? []) {
    if (character === ' ') continue;
    const template = buildTemplate(font, character);
    const key = `${template.width}x${template.height}:${template.footprint.map(({ filled }) => (filled ? '1' : '0')).join('')}:${template.advance}`;
    const prior = groups.get(key);
    if (prior) prior.alternatives.push(character);
    else groups.set(key, template);
  }
  return [...groups.values()];
}

function buildTemplate(font, character) {
  const pixels = [];
  const footprint = [];
  const rows = glyphRows(font, character);
  for (let y = 0; y < font.height; y += 1) {
    for (let x = 0; x < font.width; x += 1) {
      const filled = (rows[y] & (0x80 >>> x)) !== 0;
      footprint.push({ x, y, filled });
      if (filled) pixels.push({ x, y });
    }
  }
  // Only the 4×6 reader face packs an optional seventh descender row into
  // unused bits.  In the 5×7 display face those same bits are its fifth
  // visible column, not a descender.
  const descender = font.width === 4 && font.hasDescenders ? glyphDescenderRow(font, character) : 0;
  if (descender !== 0) {
    for (let x = 0; x < font.width; x += 1) {
      const filled = (descender & (0x80 >>> x)) !== 0;
      footprint.push({ x, y: font.height, filled });
      if (filled) pixels.push({ x, y: font.height });
    }
  }
  return {
    character,
    alternatives: [character],
    width: font.width,
    height: font.height + (descender !== 0 ? 1 : 0),
    advance: font.id === 'code-7x8' ? 8 : glyphAdvance(font, character),
    footprint,
    inkPixels: pixels,
  };
}

function matchesTemplate(bitmap, x, y, template, polarity) {
  for (const pixel of template.footprint) {
    const expected = polarity === 'dark-on-light' ? Number(pixel.filled) : Number(!pixel.filled);
    if (bitmap[indexOf(x + pixel.x, y + pixel.y)] !== expected) return false;
  }
  return true;
}

function hasInverseBackdrop(bitmap, x, y, template) {
  const middleX = x + Math.floor(template.width / 2);
  const middleY = y + Math.floor(template.height / 2);
  const perimeter = [
    [x - 1, middleY], [x + template.width, middleY],
    [middleX, y - 1], [middleX, y + template.height],
  ].filter(([sampleX, sampleY]) => (
    sampleX >= 0 && sampleX < TI86_SCREEN_WIDTH && sampleY >= 0 && sampleY < TI86_SCREEN_HEIGHT
  ));
  return perimeter.length > 0 && perimeter.every(([sampleX, sampleY]) => bitmap[indexOf(sampleX, sampleY)] === 1);
}

function selectTextRuns(candidates, preclaimedSymbols = []) {
  const byPosition = new Map();
  for (const candidate of candidates) {
    const key = positionKey(candidate.font, candidate.polarity, candidate.x, candidate.y);
    const existing = byPosition.get(key);
    // A glyph table can contain a visual collision (compact U/V, for
    // example).  Keep that ambiguity explicit rather than inventing a letter.
    if (!existing) byPosition.set(key, candidate);
    else if (candidate.alternatives.length > existing.alternatives.length) byPosition.set(key, candidate);
  }

  const runs = [...byPosition.values()].map((candidate) => makeRun(candidate, byPosition));
  const claimed = new Uint8Array(TI86_SCREEN_PIXELS);
  for (const symbol of preclaimedSymbols) for (const pixel of symbol.footprint) claimed[pixel] = 1;
  const selected = [];
  runs.sort((left, right) => (
    right.glyphs.length - left.glyphs.length
    || right.inkCount - left.inkCount
    || left.y - right.y
    || left.x - right.x
  ));
  for (const run of runs) {
    // Punctuation-only runs are typically an edge of a panel/rule rather than
    // prose. An isolated inverse glyph is normally too easy to manufacture
    // from a selection-band edge, except in the fixed function-key rail. A
    // single A–E there is a real answer affordance and must remain visible in
    // the text contract so emulator review can verify the physical mapping.
    if (!/[A-Za-z0-9]/.test(run.text)) continue;
    if (run.polarity === 'light-on-dark' && run.glyphs.length < 2 && run.y < 56) continue;
    if (run.glyphs.some((glyph) => glyph.footprint.some((pixel) => claimed[pixel]))) continue;
    for (const glyph of run.glyphs) for (const pixel of glyph.footprint) claimed[pixel] = 1;
    selected.push(run);
  }
  return selected.sort((left, right) => left.y - right.y || left.x - right.x);
}

function makeRun(start, candidates) {
  const glyphs = [start];
  let current = start;
  const spacesBefore = [0];
  const spaceAdvance = current.font === 'reader-4x6' ? 3 : current.font === 'display-5x7' ? 6 : 4;
  for (let guard = 0; guard < 31; guard += 1) {
    const base = current.x + current.advance;
    let next = null;
    let spaces = 0;
    for (let gap = 0; gap <= 5; gap += 1) {
      const candidate = candidates.get(positionKey(current.font, current.polarity, base + (gap * spaceAdvance), current.y));
      if (candidate) { next = candidate; spaces = gap; break; }
    }
    if (!next) break;
    spacesBefore.push(spaces);
    glyphs.push(next);
    current = next;
  }
  return {
    x: start.x,
    y: start.y,
    font: start.font,
    polarity: start.polarity,
    text: visibleRunText(glyphs, spacesBefore),
    glyphs,
    inkCount: glyphs.reduce((sum, glyph) => sum + glyph.inkPixels.length, 0),
  };
}

function visibleCharacter(glyph) {
  return glyph.alternatives.length === 1 ? glyph.character : `{${glyph.alternatives.join('/')}}`;
}

function visibleRunText(glyphs, spacesBefore) {
  return glyphs.map((glyph, index) => {
    const prefix = index === 0 ? '' : ' '.repeat(spacesBefore[index]);
    return `${prefix}${visibleCharacter(glyph)}`;
  }).join('');
}

function detectChrome(bitmap) {
  const chrome = new Uint8Array(TI86_SCREEN_PIXELS);
  // Solid title/softkey/selection bands read as dense rows.  They are chrome,
  // while their inverse text has already been retained in the text pass.
  for (let y = 0; y < TI86_SCREEN_HEIGHT; y += 1) {
    let dark = 0;
    for (let x = 0; x < TI86_SCREEN_WIDTH; x += 1) dark += bitmap[indexOf(x, y)];
    if (dark >= 96) for (let x = 0; x < TI86_SCREEN_WIDTH; x += 1) chrome[indexOf(x, y)] = 1;
  }
  // Panel borders and rules are long horizontal/vertical strokes.  Remove the
  // stroke itself, not the rectangle it surrounds.
  for (let y = 0; y < TI86_SCREEN_HEIGHT; y += 1) markLongRuns(bitmap, chrome, 0, y, 1, 0, 14);
  for (let x = 0; x < TI86_SCREEN_WIDTH; x += 1) markLongRuns(bitmap, chrome, x, 0, 0, 1, 14);
  return chrome;
}

function markLongRuns(bitmap, chrome, startX, startY, stepX, stepY, minimum) {
  const points = [];
  for (let x = startX, y = startY; x < TI86_SCREEN_WIDTH && y < TI86_SCREEN_HEIGHT; x += stepX, y += stepY) {
    if (bitmap[indexOf(x, y)]) points.push(indexOf(x, y));
    else {
      if (points.length >= minimum) for (const point of points) chrome[point] = 1;
      points.length = 0;
    }
  }
  if (points.length >= minimum) for (const point of points) chrome[point] = 1;
}

function renderBraille(bitmap, { consumed, chrome, sourceRowsPerDot = 1 }) {
  const lines = [];
  const dots = [0x01, 0x02, 0x04, 0x40, 0x08, 0x10, 0x20, 0x80];
  for (let y = 0; y < TI86_SCREEN_HEIGHT; y += 4 * sourceRowsPerDot) {
    let line = '';
    for (let x = 0; x < TI86_SCREEN_WIDTH; x += 2) {
      let mask = 0;
      for (let offsetY = 0; offsetY < 4; offsetY += 1) {
        for (let offsetX = 0; offsetX < 2; offsetX += 1) {
          const sourceY = y + (offsetY * sourceRowsPerDot);
          let present = false;
          for (let sourceOffset = 0; sourceOffset < sourceRowsPerDot; sourceOffset += 1) {
            const pixel = indexOf(x + offsetX, sourceY + sourceOffset);
            if (bitmap[pixel] && !consumed[pixel] && !chrome[pixel]) present = true;
          }
          if (present) {
            mask |= dots[(offsetX * 4) + offsetY];
          }
        }
      }
      line += String.fromCodePoint(0x2800 + mask);
    }
    lines.push(line.replace(/⠀+$/u, ''));
  }
  return lines.join('\n');
}

function freezeRun(run) {
  return Object.freeze({
    ...run,
    glyphs: Object.freeze(run.glyphs.map((glyph) => Object.freeze({
      ...glyph,
      alternatives: Object.freeze([...glyph.alternatives]),
      inkPixels: Object.freeze([...glyph.inkPixels]),
      footprint: Object.freeze([...glyph.footprint]),
    }))),
  });
}

function freezeSymbol(symbol) {
  return Object.freeze({
    ...symbol,
    inkPixels: Object.freeze([...symbol.inkPixels]),
    footprint: Object.freeze([...symbol.footprint]),
  });
}

function indexOf(x, y) { return (y * TI86_SCREEN_WIDTH) + x; }
function positionKey(font, polarity, x, y) { return `${font}|${polarity}|${x}|${y}`; }
function polarityMark(polarity) { return polarity === 'dark-on-light' ? '+' : '-'; }
function fontMark(font) {
  return font === 'code-7x8' ? 'k' : font === 'compact-3x5' ? 'c' : font === 'reader-4x6' ? 'r' : 'd';
}
function iconSymbol(id) {
  return {
    home: '⌂', next: '❯', previous: '❮', back: '↩', exit: '⎋', open: '❯',
    info: 'ⓘ', download: '⇩', search: '⌕', sync: '⇅', queue: '☷', mark: '✦',
    flip: '↻', qr: '▦', check: '✓', close: '×', up: '↑', down: '↓', menu: '☰',
    a: 'Ⓐ', b: 'Ⓑ', c: 'Ⓒ', d: 'Ⓓ', e: 'Ⓔ',
  }[id] ?? '▪';
}
