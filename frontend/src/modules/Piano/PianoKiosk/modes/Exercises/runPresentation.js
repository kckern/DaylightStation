/**
 * runPresentation — what a rung makes the exercise run LOOK like.
 *
 * Pure: no React, no fetching, no logging, no throwing. Everything here answers
 * a presentation question the run must not answer inline, and every one of them
 * is reused by the hosts that mount the run (a gate knows its level's tier and
 * its material's key long before the run does).
 *
 * Nothing in this module grades anything. `deriveRunTier` decides what is
 * DRAWN; the requirement decides what is judged, and the two are independent.
 */

/**
 * Which way black keys are spelled on a staff, from the key the material is in.
 *
 * `SvgSequenceStaff`'s own default is `'sharp'`, which renders the B♭ of F
 * major as A♯ — the wrong letter, on the one surface a child is reading letters
 * from. A key that cannot be read falls back to sharps rather than to
 * `spellAccidental`'s no-argument coin flip, which on a kiosk means the same
 * note flickering between spellings between renders.
 *
 * The rule is the key signature's own: a tonic spelled with a flat is a flat
 * key; a tonic spelled with a sharp is a sharp key; and of the naturals, F
 * major and the D/G/C/F minors carry flats. Quality matters — D major has two
 * sharps and D minor has one flat, and the letter alone cannot tell them apart.
 *
 * @param {string|null} key e.g. `'F'`, `'Bb'`, `'B♭'`, `'D minor'`, `'Dm'`.
 * @returns {'sharp'|'flat'}
 */
export function accidentalForKey(key) {
  if (typeof key !== 'string') return 'sharp';
  const text = key.trim();
  const letter = text.charAt(0).toUpperCase();
  // The length check is not redundant: `'ABCDEFG'.includes('')` is true, so an
  // empty key would otherwise fall through and be answered as F major.
  if (letter.length !== 1 || !'ABCDEFG'.includes(letter)) return 'sharp';
  const rest = text.slice(1);
  const sign = rest.charAt(0);
  if (sign === 'b' || sign === '♭') return 'flat';
  if (sign === '#' || sign === '♯') return 'sharp';
  const quality = rest.trim().toLowerCase();
  const minor = quality === 'm' || quality.startsWith('min') || quality === 'aeolian';
  return (minor ? 'DGCF' : 'F').includes(letter) ? 'flat' : 'sharp';
}

/** Mode/quality axis values that mean "this is a minor key". */
const MINOR_FLAVOURS = new Set(['aeolian', 'minor', 'natural-minor', 'harmonic-minor', 'melodic-minor']);

/**
 * The key of a bank instance, spelled the way `accidentalForKey` needs to read it.
 *
 * The bank writes `instance.key` as the ROOT PITCH CLASS ALONE — `'D'`, never
 * `'D minor'` — and puts the quality on a separate axis (`axes.mode` for the
 * scale bank, `axes.quality` for chords). So `accidentalForKey(instance.key)`
 * on its own can never reach its minor branch: every D minor instance in the
 * bank would be spelled with sharps, and its B♭ drawn as A♯.
 *
 * That is why this exists rather than a second accidental rule: it re-joins the
 * two halves the bank splits, and the one signature rule stays in one place.
 * Major material is unaffected — F major's `key: 'F'` already answers `flat`.
 */
export function instanceKeySignature(instance) {
  const key = instance?.key;
  if (typeof key !== 'string' || !key.trim()) return null;
  const axes = instance?.axes ?? {};
  const flavour = String(axes.mode ?? axes.quality ?? '').trim().toLowerCase();
  return MINOR_FLAVOURS.has(flavour) ? `${key.trim()} minor` : key;
}

/**
 * The pitch windows one staff holds without ledger lines nobody can count.
 * Treble: C4 (one ledger below) up to A5 (one ledger above). Bass: E2 up to C4.
 * Both land inside the ±ledger band `SvgSequenceStaff` already draws its held
 * ghosts within, so an ask that fits here is an ask that renders legibly.
 */
const TREBLE_WINDOW = [60, 81];
const BASS_WINDOW = [40, 60];
/** A reinforcement staff is for an ask a child can take in at once. */
const MAX_ASK_SPAN = 12;

/** Every midi in an ask, in event order. */
function askMidis(events) {
  return (events ?? []).flatMap((event) => (event?.notes ?? [])
    .map((note) => note?.midi)
    .filter((midi) => Number.isFinite(midi)));
}

const within = ([low, high], midis) => midis.every((midi) => midi >= low && midi <= high);

/**
 * The one clef this ask belongs on, or `null` when no single clef holds it.
 * Treble wins a tie (an ask of C4 alone), matching "C4 and above is treble".
 */
export function clefForAsk(events) {
  const midis = askMidis(events);
  if (!midis.length) return null;
  if (within(TREBLE_WINDOW, midis)) return 'treble';
  if (within(BASS_WINDOW, midis)) return 'bass';
  return null;
}

/**
 * Is this ask small enough to reinforce with a staff? Two conditions, both
 * needed: it spans no more than an octave, and one clef holds all of it. An ask
 * that fails either is still a complete ask on lit keys — the staff is what
 * degrades, not the task.
 */
export function staffFitsAsk(events) {
  const midis = askMidis(events);
  if (!midis.length) return false;
  if (Math.max(...midis) - Math.min(...midis) > MAX_ASK_SPAN) return false;
  return clefForAsk(events) !== null;
}

/**
 * The clef an instance's own notation declares, when it declares one: an
 * explicit `staff`, else the hand every note is played by. Material that spans
 * both hands returns `null` and lets the renderer decide by majority — one
 * sequence staff cannot be two staves.
 */
export function clefForInstance(instance) {
  const declared = instance?.staff;
  if (declared === 'treble' || declared === 'bass') return declared;
  const hands = new Set();
  for (const event of instance?.events ?? []) {
    for (const note of event?.notes ?? []) hands.add(note?.hand ?? null);
  }
  if (hands.size !== 1) return null;
  const [hand] = [...hands];
  if (hand === 'right') return 'treble';
  if (hand === 'left') return 'bass';
  return null;
}

/** One entry per event; an event carrying several notes becomes a chord column. */
export function eventsToStaffNotes(events) {
  return (events ?? []).map((event) => {
    const midis = (event?.notes ?? []).map((note) => note?.midi).filter((midi) => Number.isFinite(midi));
    return midis.length > 1 ? { midis } : { midi: midis[0] };
  });
}

/**
 * The tier a caller that named none is owed.
 *
 * `ordering: 'any'` material — a chord, an interval, anything whose own
 * contract is "in any order" — is a lit-keys ask at every tier: there is no
 * ordered notation for an unordered ask, and drawing one on a grand staff was
 * the thing this redesign is replacing. Everything else reads its tier off the
 * requirement: a cued ask is tier 3 (it is being judged against a beat, which
 * needs written rhythm), anything else is tier 2.
 */
export function deriveRunTier(instance, mode) {
  if (instance?.ordering === 'any') return 1;
  return mode === 'cued' ? 3 : 2;
}

/**
 * Which stage a tier mounts. `ordering: 'any'` overrides the tier for the
 * reason above — including a tier a host named explicitly, because the
 * alternative is a stage that cannot draw the material it was given.
 */
export function stageForTier(tier, instance) {
  if (instance?.ordering === 'any' || tier <= 1) return 'keys';
  return tier === 2 ? 'sequence' : 'notation';
}
