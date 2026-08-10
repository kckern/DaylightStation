/**
 * scorePlate — deterministic cover art for a score that has no scanned poster.
 *
 * The subject is 19th-century engraved piano repertoire, so the tile is an
 * ENGRAVER'S PLATE: a guilloche rosette (the interlaced curve-work used on
 * period sheet-music covers and banknotes) under a letterpress eyebrow, over a
 * plate number. Geometry is a star polygon crossed with a petal rosette —
 * radial, faceted, continuous-line. Deliberately NOT the square-cell identicon
 * used for Karaoke material (MaterialGlyph): same idea of stable visual
 * identity, different vocabulary, because these are different libraries and
 * should not be confusable.
 *
 * Everything derives from the TITLE alone — no fetch, no MusicXML parse — so a
 * grid of 39 renders with zero network cost.
 */

const FNV_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit. Same function the rest of the kiosk uses for stable seeds. */
export function hashString(str) {
  let h = FNV_BASIS;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** Independent hash streams from one seed, so shape and colour don't correlate. */
const salted = (seed, salt) => hashString(`${salt}:${seed}`);

/**
 * Pull the structured parts out of an importer-generated title, e.g.
 * "Burgmüller Op. 100 No. 17 — La Babillarde" or
 * "Clementi Op. 36 No. 01 — Sonatina (I. Spiritoso)".
 *
 * Free-form titles ("Gymnopédie No. 1") degrade gracefully: everything lands in
 * `name` and the plate simply has no eyebrow or plate number.
 */
export function parseScoreTitle(raw) {
  const str = String(raw || '').trim();
  const out = { composer: null, opus: null, number: null, name: str, movement: null };
  if (!str) return out;

  const dash = str.indexOf(' — ');
  let head = null;
  let tail = str;
  if (dash > -1) {
    head = str.slice(0, dash).trim();
    tail = str.slice(dash + 3).trim();
  } else {
    // An untitled piece has no " — title" at all (Schumann marks Op.68 No.26
    // "* * *", so the importer emits just the set and number). Read the whole
    // string as the head, or the piece loses its composer — and with it the ink
    // that keeps a whole opus looking like one family.
    const bare = str.match(/^(.+?)\s+Op\.\s*\d+(?:\s+No\.\s*\d+)?$/i);
    if (bare) { head = str; tail = ''; }
  }

  // A head is only structured if it actually carries an opus or a number;
  // otherwise it is part of the name and must not be mistaken for a composer.
  if (head) {
    const opus = head.match(/\bOp\.\s*(\d+)/i);
    const num = head.match(/\bNo\.\s*(\d+)/i);
    if (opus || num) {
      out.opus = opus ? Number(opus[1]) : null;
      out.number = num ? Number(num[1]) : null;
      const composer = head.replace(/\bOp\.\s*\d+/i, '').replace(/\bNo\.\s*\d+/i, '').trim();
      out.composer = composer || null;
    } else {
      tail = str; // not a structured head — treat the whole string as the name
    }
  }

  // Trailing "(I. Spiritoso)" is a movement, not part of the name.
  const mv = tail.match(/\s*\(([IVX]+)\.?\s*([^)]*)\)\s*$/);
  if (mv) {
    out.movement = mv[2].trim() ? `${mv[1]}. ${mv[2].trim()}` : mv[1];
    tail = tail.slice(0, mv.index).trim();
  }
  // An untitled piece keeps an empty name — the plate shows the stamp alone
  // rather than repeating "Schumann Op. 68 No. 26" under its own eyebrow.
  out.name = out.composer && !tail ? '' : (tail || str);
  return out;
}

// Period inks. The three composers actually in the library get hand-picked
// historical colours; anything else derives a muted ink from its own hash, so
// the scheme keeps working as the library grows.
const COMPOSER_INK = {
  Burgmüller: { ink: '#6d4526', deep: '#3d2413' }, // sepia
  Clementi: { ink: '#2f4257', deep: '#1b2733' },   // iron gall
  Schumann: { ink: '#6a2f36', deep: '#3a171c' },   // oxblood
  Bach: { ink: '#3f5140', deep: '#222d23' },       // verdigris
  Mozart: { ink: '#5a4a72', deep: '#312840' },     // aubergine
};

/** Ink pair for a composer — stable, and period-correct where we know them. */
export function inkFor(composer) {
  const known = COMPOSER_INK[String(composer || '').trim()];
  if (known) return known;
  const hue = salted(composer || 'anonymous', 'ink') % 360;
  return { ink: `hsl(${hue} 34% 32%)`, deep: `hsl(${hue} 38% 18%)` };
}

const TAU = Math.PI * 2;
const pt = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
const fmt = (n) => Math.round(n * 100) / 100;

/** Greatest common divisor — decides how many cycles a star polygon needs. */
export function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) { [x, y] = [y, x % y]; }
  return x;
}

/**
 * Choose a usable step for a star polygon on `n` points.
 *
 * Each cycle of {n/k} visits n / gcd(n,k) vertices, so a step where that drops
 * to 2 draws DIGONS — straight lines through the centre, not a star. {8/4} is
 * the case that surfaced: four diameters crossing, which read as a broken
 * asterisk rather than guilloche. Step down until every cycle is a real polygon.
 */
export function starStep(n, wanted) {
  for (let k = wanted; k >= 2; k -= 1) {
    if (n / gcd(n, k) >= 3) return k;
  }
  return 2;
}

/**
 * Star polygon {n/k} as one path per closed cycle. When n and k share a factor
 * the figure is several overlapping polygons (6/2 → two triangles, a hexagram)
 * rather than one continuous line — so every cycle is emitted, and the result
 * still reads as intentional guilloche rather than a broken shape.
 */
export function starPolygon({ n, k, r, cx = 50, cy = 50, rotation = 0 }) {
  const cycles = gcd(n, k) || 1;
  const paths = [];
  for (let start = 0; start < cycles; start += 1) {
    const pts = [];
    let i = start;
    do {
      const [x, y] = pt(cx, cy, r, rotation + (TAU * i) / n);
      pts.push(`${fmt(x)},${fmt(y)}`);
      i = (i + k) % n;
    } while (i !== start);
    paths.push(`M${pts.join('L')}Z`);
  }
  return paths;
}

/**
 * One petal of the rosette: a pointed leaf from the centre out to `outer`,
 * its waist set by `width`. Quadratic curves, so the silhouette stays soft
 * against the star's hard facets.
 */
export function petalPath({ cx = 50, cy = 50, inner, outer, width, angle }) {
  const [tipX, tipY] = pt(cx, cy, outer, angle);
  const [baseX, baseY] = pt(cx, cy, inner, angle);
  const [c1x, c1y] = pt(cx, cy, (inner + outer) / 2, angle - width);
  const [c2x, c2y] = pt(cx, cy, (inner + outer) / 2, angle + width);
  return `M${fmt(baseX)},${fmt(baseY)}Q${fmt(c1x)},${fmt(c1y)} ${fmt(tipX)},${fmt(tipY)}`
    + `Q${fmt(c2x)},${fmt(c2y)} ${fmt(baseX)},${fmt(baseY)}Z`;
}

/**
 * Full rosette geometry for a seed. Pure data — the component only draws it.
 *
 * @returns {{folds, star, petals, rings, centre}}
 */
export function rosette(seed) {
  const shape = salted(seed, 'shape');
  const spin = salted(seed, 'spin');
  const petalHash = salted(seed, 'petal');

  // NOTE: every shift here is `>>>`, not `>>`. FNV hashes routinely exceed 2^31,
  // and a signed shift turns those negative — which silently produced k = 1
  // (a plain polygon, no star) and would have gone on to yield negative radii.
  //
  // 7..13 points, skipping 2..4 — the range where star polygons stay legible
  // at thumbnail size. Below 7 reads as a plain polygon, above 13 turns to mush.
  const n = 7 + (shape % 7);
  const k = starStep(n, 2 + ((shape >>> 4) % 3));
  const rotation = ((spin % 360) * Math.PI) / 180;

  const folds = 5 + (petalHash % 4);          // 5..8 petals
  const petalOuter = 40 + ((petalHash >>> 3) % 6);
  const petalWidth = 0.16 + ((petalHash >>> 6) % 5) * 0.03;

  const petals = [];
  for (let i = 0; i < folds; i += 1) {
    petals.push(petalPath({
      inner: 7,
      outer: petalOuter,
      width: petalWidth,
      angle: rotation + (TAU * i) / folds,
    }));
  }

  return {
    folds,
    n,
    k,
    star: starPolygon({ n, k, r: 33 + (shape % 5), rotation }),
    petals,
    // Two hairline rings frame the medallion the way a plate border does.
    rings: [46, 30 + ((shape >>> 8) % 6)],
    centre: 4.5 + ((spin >>> 5) % 3),
  };
}

/** Everything the view needs, from a display title. */
export function plateFor(title) {
  const parts = parseScoreTitle(title);
  const seed = `plate:${String(title || '').toLowerCase()}`;
  return { ...parts, seed, ink: inkFor(parts.composer), rosette: rosette(seed) };
}

export default { plateFor, parseScoreTitle, rosette, starPolygon, starStep, petalPath, inkFor, hashString, gcd };
