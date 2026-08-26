import { describe, it, expect } from 'vitest';
import { offeredActions, cardSentence } from '#domains/school/selfService/offeredActions.mjs';
import { TRANSITIONS } from '#domains/school/sessions/sessionEvents.mjs';

/**
 * What `school.yml selfService.mediaSurface` actually emits: a BARE SURFACE ID.
 * This is the default here on purpose — a suite that defaults to the richer
 * `{id, label}` shape tests a path production never takes, and hid for a while
 * that the room-naming button was unreachable through the real config.
 */
const SHIPPED_SURFACE = 'livingroom-tv';
/** The shape a caller must build to get the room named on the button (D4). */
const NAMED_ROOM = { id: 'livingroom-tv', label: 'living room' };

const OPTS = { mediaSurface: SHIPPED_SURFACE, bankPrintable: false };
const opts = (over = {}) => ({ ...OPTS, ...over });
const withRoom = (over = {}) => opts({ mediaSurface: NAMED_ROOM, ...over });

/**
 * Unit fields are BARE STRING REFERENCES — `unitValidation.mjs` resolves
 * `bank`/`document`/`media` through `RESOLVABLE_REFS` into id sets, so none of
 * them is an object. Only truthiness is read today, but fixtures that invent
 * object shapes are what made the phantom `unit.media.surface` look real
 * (c06e2c256). `launch` is the one genuine object.
 */
const MEDIA = 'manifest-1';
const DOCUMENT = 'doc-1';
const BANK = 'b1';
const LAUNCH = { surface: 'garage-fitness' };

/** A `move` resolution — the shape `ResolveSubjectNext` returns for `kind: 'move'`. */
const move = (unit, state = 'created', stateExtras = {}) => ({
  kind: 'move',
  move: { kind: 'ignored-by-this-module', tokenClass: 'select_unit', label: 'carry on' },
  sessionId: 's1',
  state: { state, learnerId: 'kid', ...stateExtras },
  unit,
  entry: { unitId: unit?.unitId ?? 'u1', subject: unit?.subject ?? 'maths' },
});

const needsRemediation = (unit) => move(unit, 'outcome_recorded', { outcome: { result: 'needs_remediation' } });

const kinds = (actions) => actions.map((a) => a.kind);

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

describe('non-move resolutions offer no work, only a way out', () => {
  it.each([
    ['served', { kind: 'served', subjectLabel: 'maths' }],
    ['locked', { kind: 'locked', remedy: 'Finish Tuesday first.' }],
    ['empty', { kind: 'empty' }],
    ['unavailable', { kind: 'unavailable' }],
  ])('%s offers only the exit', (_label, resolution) => {
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['exit']);
  });

  it.each([
    ['served', { kind: 'served', subjectLabel: 'maths' }, 'You already did this today.'],
    ['empty', { kind: 'empty' }, 'Tell a grown-up.'],
    ['unavailable', { kind: 'unavailable' }, 'Tell a grown-up.'],
  ])('%s says its own sentence', (_label, resolution, sentence) => {
    expect(cardSentence(resolution)).toBe(sentence);
  });

  it('repeats the locked remedy verbatim', () => {
    const remedy = 'Finish Tuesday first, then this opens.';
    expect(cardSentence({ kind: 'locked', remedy })).toBe(remedy);
  });

  it('falls back to a sentence when a locked resolution carries no remedy', () => {
    expect(cardSentence({ kind: 'locked', remedy: null })).toBeTruthy();
  });
});

describe('a program resolution opens in place on the panel', () => {
  const resolution = { kind: 'program', programId: 'typing', unit: { title: 'Typing Club' } };

  it('offers exactly one program action plus the exit', () => {
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['program', 'exit']);
  });

  it('targets the program id', () => {
    expect(offeredActions(resolution, opts())[0].target).toBe('typing');
  });

  it('names the program on the button', () => {
    expect(offeredActions(resolution, opts())[0].label).toBe('Open Typing Club');
  });

  it('names the program id when the entry carries no unit', () => {
    const bare = { kind: 'program', programId: 'chess', unit: null };
    expect(offeredActions(bare, opts())[0].label).toBe('Open chess');
  });

  it('says nothing extra — the button is the whole card', () => {
    expect(cardSentence(resolution)).toBeNull();
  });
});

describe('a move at `created` offers exactly one action, mirroring nextMove', () => {
  it.each([
    [
      'a launch unit dispatches to its own surface',
      { launch: LAUNCH },
      { bankPrintable: false },
      { kind: 'launch', target: 'garage-fitness', label: 'Go do this' },
    ],
    [
      'a launch unit keeps the author\'s wording',
      { launch: { ...LAUNCH, labelHint: 'go ride the bike' } },
      { bankPrintable: false },
      { kind: 'launch', target: 'garage-fitness', label: 'Go ride the bike' },
    ],
    [
      'a media unit plays on the configured surface',
      { media: MEDIA },
      { bankPrintable: false },
      { kind: 'play', target: 'livingroom-tv', label: 'Play the video' },
    ],
    [
      'a document unit prints',
      { document: DOCUMENT },
      { bankPrintable: false },
      { kind: 'print', target: undefined, label: 'Print your sheet' },
    ],
    [
      'a printable bank unit prints',
      { bank: BANK, subject: 'maths' },
      { bankPrintable: true },
      { kind: 'print', target: undefined, label: 'Print your worksheet' },
    ],
    [
      'an unprintable bank unit runs on the panel',
      { bank: BANK, subject: 'maths' },
      { bankPrintable: false },
      { kind: 'screen', target: undefined, label: 'Answer on the screen' },
    ],
  ])('%s', (_label, unit, over, expected) => {
    const [action, ...rest] = offeredActions(move(unit), opts(over));
    expect(action).toMatchObject({ kind: expected.kind, label: expected.label });
    expect(action.target).toBe(expected.target);
    expect(kinds(rest)).toEqual(['exit']);
  });

  it('offers no work for a unit with nothing on it, but still a way out', () => {
    expect(kinds(offeredActions(move({ unitId: 'u1' }), opts()))).toEqual(['exit']);
    expect(cardSentence(move({ unitId: 'u1' }))).toBeTruthy();
  });

  it('survives a resolution whose unit could not be found', () => {
    expect(kinds(offeredActions(move(null), opts()))).toEqual(['exit']);
  });
});

describe('print and play are never offered together (D8)', () => {
  const withBoth = { media: MEDIA, document: DOCUMENT };

  it('offers only the video while the session is still at `created`', () => {
    expect(kinds(offeredActions(move(withBoth), opts()))).toEqual(['play', 'exit']);
  });

  it('offers the worksheet once the video has completed', () => {
    expect(kinds(offeredActions(move(withBoth, 'media_completed'), opts()))).toEqual(['print', 'exit']);
  });

  it.each([
    ['created', 'created'],
    ['media_completed', 'media_completed'],
    ['media_stalled', 'media_stalled'],
    ['issued', 'issued'],
    ['reprinted', 'reprinted'],
  ])('offers one work action at %s, never print and play together', (_label, state) => {
    const offered = kinds(offeredActions(move(withBoth, state), opts({ bankPrintable: true })));
    expect(offered.filter((kind) => kind !== 'exit')).toHaveLength(1);
    expect(offered.includes('print') && offered.includes('play')).toBe(false);
  });
});

describe('the print-vs-screen call is passed in, never made here', () => {
  const civBank = { bank: 'civ-1', subject: 'civilization' };

  it.each([
    ['created', 'created'],
    ['media_completed', 'media_completed'],
  ])('a civilization bank unit at %s runs on the screen when bankPrintable is false', (_l, state) => {
    expect(kinds(offeredActions(move(civBank, state), opts({ bankPrintable: false })))).toEqual(['screen', 'exit']);
  });

  it.each([
    ['created', 'created'],
    ['media_completed', 'media_completed'],
  ])('a maths bank unit at %s prints when bankPrintable is true', (_l, state) => {
    const mathsBank = { bank: 'm-1', subject: 'maths' };
    expect(kinds(offeredActions(move(mathsBank, state), opts({ bankPrintable: true })))).toEqual(['print', 'exit']);
  });

  it.each([
    ['a truthy string', 'yes'],
    ['the number one', 1],
    ['an object', {}],
    ['undefined', undefined],
  ])('needs exactly `true` — %s still goes to the screen', (_label, value) => {
    const unit = { bank: BANK, subject: 'maths' };
    expect(kinds(offeredActions(move(unit), opts({ bankPrintable: value })))).toEqual(['screen', 'exit']);
  });
});

describe('later session states reuse the same builder', () => {
  it.each([
    [
      'media_completed with a document prints the questions',
      { media: MEDIA, document: DOCUMENT },
      'media_completed',
      { bankPrintable: false },
      { kind: 'print', label: 'Print the questions' },
    ],
    [
      'media_completed with a printable bank prints the questions',
      { media: MEDIA, bank: BANK },
      'media_completed',
      { bankPrintable: true },
      { kind: 'print', label: 'Print the questions' },
    ],
    [
      'media_completed with an unprintable bank goes to the screen',
      { media: MEDIA, bank: BANK },
      'media_completed',
      { bankPrintable: false },
      { kind: 'screen', label: 'Answer on the screen' },
    ],
    [
      'issued reprints',
      { document: DOCUMENT },
      'issued',
      { bankPrintable: false },
      { kind: 'print', label: 'Print it again' },
    ],
    [
      'reprinted reprints',
      { document: DOCUMENT },
      'reprinted',
      { bankPrintable: false },
      { kind: 'print', label: 'Print it again' },
    ],
    [
      'media_stalled plays again',
      { media: MEDIA },
      'media_stalled',
      { bankPrintable: false },
      { kind: 'play', label: 'Play it again' },
    ],
  ])('%s', (_label, unit, state, over, expected) => {
    const actions = offeredActions(move(unit, state), opts(over));
    expect(kinds(actions)).toEqual([expected.kind, 'exit']);
    expect(actions[0].label).toBe(expected.label);
  });

  it('reprints a bank unit at `issued` without re-asking whether it is printable', () => {
    const actions = offeredActions(move({ bank: BANK, subject: 'maths' }, 'issued'), opts({ bankPrintable: false }));
    expect(kinds(actions)).toEqual(['print', 'exit']);
  });

  it('tells a child at the panel to come back to the KEYPAD, never to scan', () => {
    // The deliberate translation of `nextMove`'s "finish watching, then scan
    // your card". Pinned literally: a regression to the paper wording would
    // send a child at a wall panel looking for a scanner, and would otherwise
    // pass green.
    const resolution = move({ media: MEDIA }, 'media_dispatched');
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['exit']);
    expect(cardSentence(resolution, opts())).toBe('Finish watching, then type your code again.');
  });

  it.each([
    ['a media-only unit', { media: MEDIA }],
    ['a unit whose only follow-up was the video', { media: MEDIA, unitId: 'u1' }],
  ])('tells %s at media_completed that it finished, not that something broke', (_label, unit) => {
    const resolution = move(unit, 'media_completed');
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['exit']);
    expect(cardSentence(resolution, opts())).toBe('All done — nice work.');
  });

  it('still sends an empty unit at created to a grown-up — that one IS a fault', () => {
    expect(cardSentence(move({ unitId: 'u1' }, 'created'), opts())).toBe('Tell a grown-up.');
  });

  it('never gives a finished video the fault wording', () => {
    // Re-merging the `created` and `media_completed` branches would turn
    // success back into "go fetch a parent"; this is the tripwire.
    expect(cardSentence(move({ media: MEDIA }, 'media_completed'), opts()))
      .not.toBe(cardSentence(move({ unitId: 'u1' }, 'created'), opts()));
  });

  it.each([
    ['a bare unit at media_completed', { unitId: 'u1' }, 'media_completed'],
    ['a bare unit at created', { unitId: 'u1' }, 'created'],
    ['a launch unit at media_dispatched', { launch: LAUNCH }, 'media_dispatched'],
  ])('never leaves %s with no button AND no sentence', (_label, unit, state) => {
    const resolution = move(unit, state);
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['exit']);
    expect(cardSentence(resolution, opts())).toBeTruthy();
  });

  it('starts the fallback sentence with a capital, like every other sentence', () => {
    // It renders beside "All done — nice work."; a lowercase fragment reads
    // like a bug. The reducer's labels are mid-sentence phrases.
    const resolution = move({ document: DOCUMENT }, 'graded');
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['exit']);
    expect(cardSentence(resolution, opts())).toBe('Carry on');
  });
});

describe('work that needs remediation gets a fresh start, not a dead end', () => {
  it.each([
    ['a document unit', { document: DOCUMENT }],
    ['a printable bank unit', { bank: BANK, subject: 'maths' }],
    ['a media unit', { media: MEDIA }],
  ])('offers the retry to %s', (_label, unit) => {
    expect(kinds(offeredActions(needsRemediation(unit), withRoom({ bankPrintable: true })))).toEqual(['retry', 'exit']);
  });

  /**
   * Every composition that can reach `outcome_recorded`. `OpenRemediation` is
   * composition-blind — it appends a fresh `created` event and always returns
   * `document: null` — so the retry button must describe whatever the FRESH
   * `created` card will offer, never assume paper.
   */
  const COMPOSITIONS = [
    ['a document unit', { document: DOCUMENT }, { bankPrintable: false }],
    ['a printable bank unit', { bank: BANK, subject: 'maths' }, { bankPrintable: true }],
    ['a screen-answered bank unit', { bank: BANK, subject: 'maths' }, { bankPrintable: false }],
    ['a screen-answered civilization bank unit', { bank: 'civ-1', subject: 'civilization' }, { bankPrintable: false }],
    ['a launch unit', { launch: LAUNCH }, { bankPrintable: false }],
    ['a launch unit with its own wording', { launch: { ...LAUNCH, labelHint: 'go ride the bike' } }, { bankPrintable: false }],
    ['a media unit', { media: MEDIA }, { bankPrintable: false }],
    ['a media unit with a worksheet behind it', { media: MEDIA, document: DOCUMENT }, { bankPrintable: false }],
  ];

  it.each(COMPOSITIONS)('%s is promised what the fresh created card actually offers', (_label, unit, over) => {
    const options = opts(over);
    const [retry] = offeredActions(needsRemediation(unit), options);
    const [fresh] = offeredActions(move(unit, 'created'), options);

    // The invariant, asserted as AGREEMENT rather than eight literals so it
    // cannot drift: the only licensed divergence is the paper case, where
    // "a fresh sheet" is what distinguishes a remediation from a reprint.
    expect(retry.kind).toBe('retry');
    expect(retry.label).toBe(fresh.kind === 'print' ? 'Print a fresh sheet' : fresh.label);
  });

  it.each([
    ['a document unit', { document: DOCUMENT }, { bankPrintable: false }, 'Print a fresh sheet'],
    ['a printable bank unit', { bank: BANK }, { bankPrintable: true }, 'Print a fresh sheet'],
    ['a screen-answered bank unit', { bank: BANK }, { bankPrintable: false }, 'Answer on the screen'],
    ['a launch unit', { launch: LAUNCH }, { bankPrintable: false }, 'Go do this'],
    ['a media unit', { media: MEDIA }, { bankPrintable: false }, 'Play the video'],
  ])('%s reads as its own destination', (_label, unit, over, label) => {
    // The literals the child actually sees, pinned alongside the invariant so
    // the wording is visible in one place rather than only derivable.
    expect(offeredActions(needsRemediation(unit), opts(over))[0].label).toBe(label);
  });

  it('names the room on a retry too, when the caller supplied one', () => {
    expect(offeredActions(needsRemediation({ media: MEDIA }), withRoom())[0].label)
      .toBe('Play in the living room');
  });

  it('falls back to plain wording for a unit with nothing on it', () => {
    const actions = offeredActions(needsRemediation({ unitId: 'u1' }), opts());
    expect(kinds(actions)).toEqual(['retry', 'exit']);
    expect(actions[0].label).toBe('Try again');
  });

  it('keeps `retry` as the identity whatever the label says', () => {
    // Task 7 finds the action by kind and routes it to `OpenRemediation`. The
    // label follows the composition; the kind must not.
    for (const [, unit, over] of COMPOSITIONS) {
      expect(offeredActions(needsRemediation(unit), opts(over))[0].kind).toBe('retry');
    }
  });

  it('runs off the panel, so there is no room to walk to', () => {
    expect(offeredActions(needsRemediation({ document: DOCUMENT }), opts())[0].target).toBeUndefined();
  });

  it('says nothing extra — the button is the answer', () => {
    expect(cardSentence(needsRemediation({ document: DOCUMENT }), opts())).toBeNull();
  });

  it('does not offer it once the work passed', () => {
    const passed = move({ document: DOCUMENT }, 'outcome_recorded', { outcome: { result: 'passed' } });
    expect(kinds(offeredActions(passed, opts()))).toEqual(['exit']);
    expect(cardSentence(passed, opts())).toBeTruthy();
  });

  it('never reprints the graded session instead — that would be refused by ISSUABLE', () => {
    expect(kinds(offeredActions(needsRemediation({ document: DOCUMENT }), opts()))).not.toContain('print');
  });
});

describe('the media surface names the room only when the caller supplies one', () => {
  it('says just what the button does for the bare id `school.yml` emits', () => {
    const [action] = offeredActions(move({ media: MEDIA }), opts());
    expect(action).toMatchObject({ kind: 'play', target: 'livingroom-tv', label: 'Play the video' });
  });

  it('names the room when the caller passes {id, label}', () => {
    const [action] = offeredActions(move({ media: MEDIA }), withRoom());
    expect(action).toMatchObject({ kind: 'play', target: 'livingroom-tv', label: 'Play in the living room' });
  });

  it('names the room on the restart button too', () => {
    const [action] = offeredActions(move({ media: MEDIA }, 'media_stalled'), withRoom());
    expect(action).toMatchObject({ kind: 'play', target: 'livingroom-tv', label: 'Play it again in the living room' });
  });

  it('drops the room name from the restart button for a bare id', () => {
    const [action] = offeredActions(move({ media: MEDIA }, 'media_stalled'), opts());
    expect(action).toMatchObject({ kind: 'play', target: 'livingroom-tv', label: 'Play it again' });
  });

  it('still offers the video when no surface was configured', () => {
    const [action] = offeredActions(move({ media: MEDIA }), { bankPrintable: false });
    expect(action).toMatchObject({ kind: 'play', label: 'Play the video' });
    expect(action.target).toBeUndefined();
  });

  it('targets the id from either shape, so Task 7 dispatches the same either way', () => {
    const bare = offeredActions(move({ media: MEDIA }), opts())[0].target;
    const named = offeredActions(move({ media: MEDIA }), withRoom())[0].target;
    expect(bare).toBe(named);
  });
});

describe('every card ends with a way out', () => {
  const everyResolution = [
    { kind: 'served', subjectLabel: 'maths' },
    { kind: 'locked', remedy: 'Not yet.' },
    { kind: 'empty' },
    { kind: 'unavailable' },
    { kind: 'program', programId: 'typing', unit: null },
    move({ launch: LAUNCH }),
    move({ media: MEDIA }),
    move({ document: DOCUMENT }),
    move({ bank: BANK }),
    move({}, 'media_dispatched'),
    move({}, 'outcome_recorded'),
    needsRemediation({ document: DOCUMENT }),
    move({}, 'submitted'),
    move({}, 'graded'),
    move({}, 'launch_dispatched'),
    move({}, 'abandoned'),
    { kind: 'something-new-nobody-wrote-yet' },
  ];

  it.each(everyResolution.map((r, i) => [`${r.kind}#${i}`, r]))('%s ends with exit', (_label, resolution) => {
    const actions = offeredActions(resolution, opts());
    expect(actions.at(-1).kind).toBe('exit');
    expect(actions.at(-1).label).toBeTruthy();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('%s still gets a way out rather than an empty card', (_label, resolution) => {
    const actions = offeredActions(resolution, opts());
    expect(kinds(actions)).toEqual(['exit']);
    expect(cardSentence(resolution, opts())).toBeTruthy();
  });

  it('survives being called with no options at all', () => {
    expect(kinds(offeredActions(move({ media: MEDIA })))).toEqual(['play', 'exit']);
  });
});

describe('the states this module names still exist', () => {
  // A renamed or removed state would not fail anything else here — it would
  // degrade INTO the default branch, which answers with a generic "carry on"
  // and no button. That is a wording regression no assertion above can see.
  const HANDLED = [
    'created', 'media_completed', 'issued', 'reprinted',
    'media_stalled', 'outcome_recorded', 'media_dispatched',
  ];

  it.each(HANDLED)('`%s` is still a state the session machine can reach', (state) => {
    expect(Object.keys(TRANSITIONS)).toContain(state);
  });
});

describe('purity', () => {
  const resolution = deepFreeze(move({ bank: BANK, subject: 'maths' }));

  it('does not write to the resolution it was handed', () => {
    expect(kinds(offeredActions(resolution, opts({ bankPrintable: true })))).toEqual(['print', 'exit']);
  });

  it('answers the same way every time', () => {
    const once = offeredActions(resolution, opts({ bankPrintable: true }));
    const twice = offeredActions(resolution, opts({ bankPrintable: true }));
    expect(kinds(once)).toEqual(['print', 'exit']);
    expect(once).toEqual(twice);
  });

  it('returns actions that survive a JSON round trip', () => {
    const actions = offeredActions(move({ media: MEDIA }), opts());
    expect(kinds(actions)).toEqual(['play', 'exit']);
    expect(JSON.parse(JSON.stringify(actions))).toEqual(actions);
  });
});

/**
 * Resumed work (Slice E, 2026-08-22-omr-grading-integrity). Learner-Four's session was
 * created 2026-08-14, never submitted, and picked up eight days later: the card
 * said "Print it again" and the sheet that came out had a different student
 * number and started at question 7. Every part of that was correct for an
 * allocation minted on the 14th, and none of it was explicable to a child with
 * no memory of that day. The card now names the start date.
 */
describe('resumed work names the day it started', () => {
  const NOW = new Date('2026-08-22T09:00:00.000Z');
  const issuedAt = (iso) => move({ unitId: 'u1', document: DOCUMENT }, 'issued', { firstIssuedAt: iso });

  it('names the start date on work first issued days ago', () => {
    const sentence = cardSentence(issuedAt('2026-08-14T15:00:00.000Z'), opts({ now: NOW }));
    expect(sentence).toBe('Started Fri 14 Aug.');
  });

  it('still offers the reprint button — the date is context, never a refusal', () => {
    const actions = offeredActions(issuedAt('2026-08-14T15:00:00.000Z'), opts({ now: NOW }));
    expect(kinds(actions)).toContain('print');
  });

  it('says nothing for work issued the same day — under a day is continuous work, not a resume', () => {
    expect(cardSentence(issuedAt('2026-08-22T07:30:00.000Z'), opts({ now: NOW }))).toBeNull();
  });

  it('says nothing at exactly under 24h, and speaks the moment a full day has passed', () => {
    expect(cardSentence(issuedAt('2026-08-21T09:00:00.001Z'), opts({ now: NOW }))).toBeNull();
    expect(cardSentence(issuedAt('2026-08-21T09:00:00.000Z'), opts({ now: NOW }))).toBe('Started Fri 21 Aug.');
  });

  it('applies to a reprinted session too, not just the first issue', () => {
    const resolution = move({ unitId: 'u1', document: DOCUMENT }, 'reprinted', {
      firstIssuedAt: '2026-08-14T15:00:00.000Z',
    });
    expect(cardSentence(resolution, opts({ now: NOW }))).toBe('Started Fri 14 Aug.');
  });

  it('stays silent when the session never recorded a first issue, or the caller passed no clock', () => {
    expect(cardSentence(issuedAt(null), opts({ now: NOW }))).toBeNull();
    expect(cardSentence(issuedAt('2026-08-14T15:00:00.000Z'), opts())).toBeNull();
  });

  it('never speaks for a state that is not a reprint — a fresh print is not a resume', () => {
    const fresh = move({ unitId: 'u1', document: DOCUMENT }, 'media_completed', {
      firstIssuedAt: '2026-08-14T15:00:00.000Z',
    });
    expect(cardSentence(fresh, opts({ now: NOW }))).toBeNull();
  });
});
