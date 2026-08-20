import { describe, it, expect } from 'vitest';
import { offeredActions, cardSentence } from '#domains/school/selfService/offeredActions.mjs';

/** The household default from `school.yml selfService.mediaSurface`, with a room name. */
const LIVING_ROOM = { id: 'livingroom-tv', label: 'living room' };
const OPTS = { mediaSurface: LIVING_ROOM, bankPrintable: false };
const opts = (over = {}) => ({ ...OPTS, ...over });

/** A `move` resolution — the shape `ResolveSubjectNext` returns for `kind: 'move'`. */
const move = (unit, state = 'created') => ({
  kind: 'move',
  move: { kind: 'ignored-by-this-module', tokenClass: 'select_unit', label: 'ignored' },
  sessionId: 's1',
  state: { state, learnerId: 'kid' },
  unit,
  entry: { unitId: unit?.unitId ?? 'u1', subject: unit?.subject ?? 'maths' },
});

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

  it('reads the remedy under its other name too', () => {
    const remedy = 'Ask for Tuesday to be marked done.';
    expect(cardSentence({ kind: 'locked', lockedRemedy: remedy })).toBe(remedy);
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
      { launch: { surface: 'garage-fitness' } },
      { bankPrintable: false },
      { kind: 'launch', target: 'garage-fitness', label: 'Go do this' },
    ],
    [
      'a launch unit keeps the author\'s wording',
      { launch: { surface: 'garage-fitness', labelHint: 'go ride the bike' } },
      { bankPrintable: false },
      { kind: 'launch', target: 'garage-fitness', label: 'Go ride the bike' },
    ],
    [
      'a media unit plays on the media surface',
      { media: { plex: '1' } },
      { bankPrintable: false },
      { kind: 'play', target: 'livingroom-tv', label: 'Play in the living room' },
    ],
    [
      'a document unit prints',
      { document: { template: 'sheet' } },
      { bankPrintable: false },
      { kind: 'print', target: undefined, label: 'Print your sheet' },
    ],
    [
      'a printable bank unit prints',
      { bank: { bankId: 'b1' }, subject: 'maths' },
      { bankPrintable: true },
      { kind: 'print', target: undefined, label: 'Print your worksheet' },
    ],
    [
      'an unprintable bank unit runs on the panel',
      { bank: { bankId: 'b1' }, subject: 'maths' },
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
  const withBoth = { media: { plex: '1' }, document: { template: 'sheet' } };

  it('offers only the video while the session is still at `created`', () => {
    const actions = offeredActions(move(withBoth), opts());
    expect(kinds(actions)).toEqual(['play', 'exit']);
  });

  it('offers the worksheet once the video has completed', () => {
    const actions = offeredActions(move(withBoth, 'media_completed'), opts());
    expect(kinds(actions)).toEqual(['print', 'exit']);
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
  const civBank = { bank: { bankId: 'civ-1' }, subject: 'civilization' };

  it.each([
    ['created', 'created'],
    ['media_completed', 'media_completed'],
  ])('a civilization bank unit at %s runs on the screen when bankPrintable is false', (_l, state) => {
    const actions = offeredActions(move(civBank, state), opts({ bankPrintable: false }));
    expect(kinds(actions)).toEqual(['screen', 'exit']);
  });

  it.each([
    ['created', 'created'],
    ['media_completed', 'media_completed'],
  ])('a maths bank unit at %s prints when bankPrintable is true', (_l, state) => {
    const mathsBank = { bank: { bankId: 'm-1' }, subject: 'maths' };
    const actions = offeredActions(move(mathsBank, state), opts({ bankPrintable: true }));
    expect(kinds(actions)).toEqual(['print', 'exit']);
  });
});

describe('later session states reuse the same builder', () => {
  it.each([
    [
      'media_completed with a document prints the questions',
      { media: { plex: '1' }, document: { template: 'sheet' } },
      'media_completed',
      { bankPrintable: false },
      { kind: 'print', label: 'Print the questions' },
    ],
    [
      'media_completed with a printable bank prints the questions',
      { media: { plex: '1' }, bank: { bankId: 'b1' } },
      'media_completed',
      { bankPrintable: true },
      { kind: 'print', label: 'Print the questions' },
    ],
    [
      'media_completed with an unprintable bank goes to the screen',
      { media: { plex: '1' }, bank: { bankId: 'b1' } },
      'media_completed',
      { bankPrintable: false },
      { kind: 'screen', label: 'Answer on the screen' },
    ],
    [
      'issued reprints',
      { document: { template: 'sheet' } },
      'issued',
      { bankPrintable: false },
      { kind: 'print', label: 'Print it again' },
    ],
    [
      'reprinted reprints',
      { document: { template: 'sheet' } },
      'reprinted',
      { bankPrintable: false },
      { kind: 'print', label: 'Print it again' },
    ],
    [
      'media_stalled plays again',
      { media: { plex: '1' } },
      'media_stalled',
      { bankPrintable: false },
      { kind: 'play', label: 'Play it again in the living room' },
    ],
  ])('%s', (_label, unit, state, over, expected) => {
    const actions = offeredActions(move(unit, state), opts(over));
    expect(kinds(actions)).toEqual([expected.kind, 'exit']);
    expect(actions[0].label).toBe(expected.label);
  });

  it('reprints a bank unit at `issued` without re-asking whether it is printable', () => {
    const unit = { bank: { bankId: 'b1' }, subject: 'maths' };
    const actions = offeredActions(move(unit, 'issued'), opts({ bankPrintable: false }));
    expect(kinds(actions)).toEqual(['print', 'exit']);
  });

  it('offers nothing while the video is still playing, and says so', () => {
    const resolution = move({ media: { plex: '1' } }, 'media_dispatched');
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['exit']);
    expect(cardSentence(resolution)).toBeTruthy();
  });

  it.each([
    ['a launch unit at media_completed', { launch: { surface: 'garage-fitness' } }, 'media_completed'],
    ['a bare unit at media_completed', { unitId: 'u1' }, 'media_completed'],
    ['a bare unit at created', { unitId: 'u1' }, 'created'],
    ['a launch unit at media_dispatched', { launch: { surface: 'garage-fitness' } }, 'media_dispatched'],
  ])('never leaves %s with no button AND no sentence', (_label, unit, state) => {
    const resolution = move(unit, state);
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['exit']);
    expect(cardSentence(resolution, opts())).toBeTruthy();
  });

  it('offers nothing at a state the ladder does not cover', () => {
    const resolution = move({ document: { template: 'sheet' } }, 'graded');
    expect(kinds(offeredActions(resolution, opts()))).toEqual(['exit']);
    expect(cardSentence(resolution)).toBeTruthy();
  });
});

describe('the media surface', () => {
  it('accepts a bare surface id and drops the room name from the button', () => {
    const [action] = offeredActions(move({ media: { plex: '1' } }), opts({ mediaSurface: 'livingroom-tv' }));
    expect(action).toMatchObject({ kind: 'play', target: 'livingroom-tv', label: 'Play the video' });
  });

  it('drops the room name from the restart button too', () => {
    const resolution = move({ media: { plex: '1' } }, 'media_stalled');
    const [action] = offeredActions(resolution, opts({ mediaSurface: 'livingroom-tv' }));
    expect(action).toMatchObject({ kind: 'play', target: 'livingroom-tv', label: 'Play it again' });
  });

  it('still offers the video when no surface was configured', () => {
    const [action] = offeredActions(move({ media: { plex: '1' } }), { bankPrintable: false });
    expect(action).toMatchObject({ kind: 'play', label: 'Play the video' });
    expect(action.target).toBeUndefined();
  });
});

describe('every card ends with a way out', () => {
  const everyResolution = [
    { kind: 'served', subjectLabel: 'maths' },
    { kind: 'locked', remedy: 'Not yet.' },
    { kind: 'empty' },
    { kind: 'unavailable' },
    { kind: 'program', programId: 'typing', unit: null },
    move({ launch: { surface: 'garage-fitness' } }),
    move({ media: { plex: '1' } }),
    move({ document: { template: 'sheet' } }),
    move({ bank: { bankId: 'b1' } }),
    move({}, 'media_dispatched'),
    move({}, 'outcome_recorded'),
    { kind: 'something-new-nobody-wrote-yet' },
  ];

  it.each(everyResolution.map((r, i) => [`${r.kind}#${i}`, r]))('%s ends with exit', (_label, resolution) => {
    const actions = offeredActions(resolution, opts());
    expect(actions.at(-1).kind).toBe('exit');
    expect(actions.at(-1).label).toBeTruthy();
  });
});

describe('purity', () => {
  const resolution = deepFreeze(move({ bank: { bankId: 'b1' }, subject: 'maths' }));

  it('does not write to the resolution it was handed', () => {
    const actions = offeredActions(resolution, opts({ bankPrintable: true }));
    expect(kinds(actions)).toEqual(['print', 'exit']);
  });

  it('answers the same way every time', () => {
    const once = offeredActions(resolution, opts({ bankPrintable: true }));
    const twice = offeredActions(resolution, opts({ bankPrintable: true }));
    expect(kinds(once)).toEqual(['print', 'exit']);
    expect(once).toEqual(twice);
  });

  it('returns actions that survive a JSON round trip', () => {
    const actions = offeredActions(move({ media: { plex: '1' } }), opts());
    expect(kinds(actions)).toEqual(['play', 'exit']);
    expect(JSON.parse(JSON.stringify(actions))).toEqual(actions);
  });
});
