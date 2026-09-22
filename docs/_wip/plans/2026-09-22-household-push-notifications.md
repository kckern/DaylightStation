# Household Push Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Every push notification DaylightStation sends reads as finished human text: display names, local times, no ids or `None`. Each push carries a tag, group and channel, so repeats replace instead of stacking and school progress can be silenced separately from school problems.

**Architecture:** Pure domain composers build `{ title, message, data }`.

- The school composer is `2_domains/school/notifications/schoolPush.mjs`. The shared text rules are in `2_domains/notification/push/pushText.mjs`.
- Application callers (scan consumer, piano bridge, shutdown service, NFC/TV/story/approval producers) resolve display labels and call the composers.
- `SchoolGradingHookAdapter` forwards the composed object as one extra script variable, `notification`.
- The HA scripts relay it verbatim and keep their siren logic.

**Tech Stack:** Node ES modules (`.mjs`) and vitest. Run single files with
`frontend/node_modules/.bin/vitest run --config vitest.config.mjs <file>` from the worktree root.
HA scripts are YAML on the homeserver.

**Design:** `docs/_wip/plans/2026-09-22-household-push-notifications-design.md`
**Evidence:** `docs/_wip/audits/2026-09-22-ha-push-notification-audit.md`

**Rules for every task**

- Work in `/Users/kckern/Documents/GitHub/DaylightStation/.worktrees/household-push-notifications` (branch `feat/household-push-notifications`).
- **Never start a backend** (`node backend/index.js` / `npm run dev`). It is a live household controller. Unit tests only.
- **No real names in fixtures or docs.** Use ids like `user_4` and display names like `Learner4`.
- Match surrounding style: the file-header doc comments, the `logger.x?.('dotted.event', {...})` idiom, and no `console.*`.
- One commit per task. End each commit message with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Commit only the files the task names (`git add <paths>`, never `git add -A`). `node_modules` and `frontend/node_modules` are symlinks and must not be committed.

**Deliberate change from the design:** the design proposed a "replay" test over the 161 real payloads. The recorder only holds the *rendered* text, not the consumer-side inputs the composer takes, so that replay can't be built faithfully. It is replaced by:

- composer table tests built from real audit cases (anonymised);
- a consumer test for the Partial-then-Passed pair: same `sessionId`, so same tag, so it collapses;
- the defect guard run over every composer output.

---

### Task 1: Shared push text rules (`pushText.mjs`)

**Files:**
- Create: `backend/src/2_domains/notification/push/pushText.mjs`
- Test: `backend/src/2_domains/notification/push/pushText.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import {
  titleCaseId, personDisplayName, formatClockTime, formatDuration,
  formatStudyDay, pushData, findPushTextDefects,
} from './pushText.mjs';

describe('personDisplayName', () => {
  it('prefers display_name, then name, then a title-cased id', () => {
    expect(personDisplayName({ display_name: 'Learner4', name: 'x' }, 'user_4')).toBe('Learner4');
    expect(personDisplayName({ name: 'Learner5' }, 'user_5')).toBe('Learner5');
    expect(personDisplayName(null, 'user_6')).toBe('User 6');
    expect(personDisplayName({ display_name: '  ' }, null)).toBeNull();
  });
});

describe('titleCaseId', () => {
  it('turns ids into words', () => {
    expect(titleCaseId('livingroom-tv')).toBe('Livingroom Tv');
    expect(titleCaseId('living_room')).toBe('Living Room');
    expect(titleCaseId('')).toBeNull();
  });
});

describe('time formatting', () => {
  it('formats a UTC instant as local clock time', () => {
    expect(formatClockTime('2026-08-28T01:13:29.185Z', 'America/Los_Angeles')).toBe('6:13 PM');
    expect(formatClockTime('not a date', 'America/Los_Angeles')).toBeNull();
  });
  it('formats durations in minutes and hours', () => {
    expect(formatDuration(30 * 60_000)).toBe('30 min');
    expect(formatDuration(90 * 60_000)).toBe('1 hr 30 min');
    expect(formatDuration(120 * 60_000)).toBe('2 hr');
    expect(formatDuration(-5)).toBeNull();
  });
  it('formats a study day key as a short date', () => {
    expect(formatStudyDay('2026-09-14')).toBe('Mon Sep 14');
    expect(formatStudyDay('2026-9-14')).toBeNull();
  });
});

describe('pushData', () => {
  it('keeps only the metadata that is set, and spells alert_once the HA way', () => {
    expect(pushData({ tag: 't', group: null, channel: 'C', importance: 'low', alertOnce: true, actions: [1] }))
      .toEqual({ tag: 't', channel: 'C', importance: 'low', alert_once: true, actions: [1] });
    expect(pushData()).toEqual({});
  });
});

describe('findPushTextDefects', () => {
  it('passes finished text', () => {
    expect(findPushTextDefects('✅ Learner4 — Come Follow Me: Isaiah 13–17')).toEqual([]);
    expect(findPushTextDefects('What Are Flats in Music?')).toEqual([]);
  });
  it.each([
    ['None — None / None', 'none'],
    ['score null', 'null'],
    ['undefined%', 'undefined'],
    ['plex:675689 / lesson', 'plex-key'],
    ['cfm-w35-d2-psalms-62-69', 'slug'],
    ['until 2026-08-28T01:13:29.185Z', 'iso-timestamp'],
    ['What Are Flats in Music?.', 'double-punctuation'],
    ['Worksheet Needs_remediation', 'snake-case'],
    ['   ', 'empty'],
  ])('flags %s', (text, defect) => {
    expect(findPushTextDefects(text)).toContain(defect);
  });
});
```

**Step 2: Run the test to confirm it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs backend/src/2_domains/notification/push/pushText.test.mjs`
Expected: FAIL (cannot resolve `./pushText.mjs`)

**Step 3: Implement**

```js
/**
 * Shared text rules for household push notifications
 * (docs/reference/notifications/push-standard.md).
 *
 * A push is read on a lock screen by a person who did not write the code.
 * Every producer composes through these helpers so that the same mistakes
 * (raw ids, UTC timestamps, `None`) cannot come back one producer at a time.
 * Pure: no clock, no I/O.
 */

const text = (value) => (typeof value === 'string' && value.trim()
  ? value.trim().replace(/\s+/g, ' ')
  : null);

/** 'living_room' → 'Living Room'. A last resort; a configured name always wins. */
export function titleCaseId(id) {
  const raw = text(id);
  if (!raw) return null;
  return raw.split(/[-_\s]+/).filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** A person's name as the household wrote it (`profile.yml` `display_name`). */
export function personDisplayName(profile, id) {
  return text(profile?.display_name) ?? text(profile?.name) ?? titleCaseId(id);
}

/** '2026-08-28T01:13:29Z' → '6:13 PM' in the household's zone. */
export function formatClockTime(iso, timezone) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone || undefined,
  }).format(ms).replace(/ /g, ' ');
}

/** 1_800_000 → '30 min'; 5_400_000 → '1 hr 30 min'. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Study-day key '2026-09-14' → 'Mon Sep 14'. */
export function formatStudyDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return null;
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * The HA companion-app `data:` block. `tag` makes a repeat replace the earlier
 * card; `alertOnce` (HA: `alert_once`) lets that replacement arrive without
 * ringing again; `channel`/`importance` decide how loud it is on Android.
 */
export function pushData({ tag = null, group = null, channel = null, importance = null, alertOnce = false, ...extra } = {}) {
  const data = { ...extra };
  if (tag) data.tag = tag;
  if (group) data.group = group;
  if (channel) data.channel = channel;
  if (importance) data.importance = importance;
  if (alertOnce) data.alert_once = true;
  return data;
}

const DEFECTS = [
  ['none', /\bNone\b/],
  ['null', /\bnull\b/],
  ['undefined', /\bundefined\b/],
  ['plex-key', /\bplex:\d+/],
  ['slug', /\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/],
  ['iso-timestamp', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/],
  ['double-punctuation', /[?!.]\./],
  ['snake-case', /\b[A-Za-z]+_[a-z_]+\b/],
];

/** Every way the 2026-09 audit found a push rendered badly. Tests assert `[]`. */
export function findPushTextDefects(value) {
  const s = typeof value === 'string' ? value : '';
  if (!s.trim()) return ['empty'];
  return DEFECTS.filter(([, pattern]) => pattern.test(s)).map(([name]) => name);
}
```

**Step 4: Run the test to confirm it passes**

Same command. Expected: PASS. If `formatClockTime` returns `6:13 PM` with a different space character on this Node/ICU, widen the `.replace` to `/[  ]/g`.

**Step 5: Commit**

```bash
git add backend/src/2_domains/notification/push/pushText.mjs backend/src/2_domains/notification/push/pushText.test.mjs
git commit -m "feat(notification): shared push text rules and defect guard"
```

---

### Task 2: School push composer (`schoolPush.mjs`)

**Files:**
- Create: `backend/src/2_domains/school/notifications/schoolPush.mjs`
- Test: `backend/src/2_domains/school/notifications/schoolPush.test.mjs`

The composer is pure and takes one `event` object:

| field | meaning |
|---|---|
| `kind` | `graded` \| `review` \| `partial` \| `unmarked` \| `unresolved` \| `refused` \| `piano` |
| `learnerId`, `child` | id (for tag/group) and display name (for text); either may be null |
| `course`, `lesson` | display labels or null |
| `testId`, `sessionId` | card id / session id; the tag key is `sessionId ?? testId` |
| `result`, `earned`, `total`, `retake`, `studyDay`, `today` | graded only |
| `pendingReview`, `reasons` | review only |
| `blankRows`, `ambiguousRows` | partial only |
| `rowRanges`, `otherWorkGraded` | unmarked only |
| `code` | unresolved / refused |
| `unitProgress` `{label, completed, total}` | piano only |

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { composeSchoolPush } from './schoolPush.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

const base = { learnerId: 'user_4', child: 'Learner4', testId: '5278294', sessionId: 'ses_a' };
const labels = { course: 'U.S. Atlas', lesson: 'New York' };

const CASES = [
  ['passed', { ...base, ...labels, kind: 'graded', result: 'passed', earned: 6, total: 6 },
    { title: '✅ Learner4 — U.S. Atlas: New York', message: '6 of 6 correct', channel: 'School progress' }],
  ['passed, late', { ...base, ...labels, kind: 'graded', result: 'passed', earned: 4, total: 5, studyDay: '2026-09-14', today: '2026-09-20' },
    { message: '4 of 5 correct · from Mon Sep 14' }],
  ['retake cleared', { ...base, ...labels, kind: 'graded', result: 'passed', earned: 3, total: 3, retake: true },
    { title: '✅ Learner4 — U.S. Atlas: New York', message: 'Retake: 3 of 3 correct' }],
  ['needs remediation', { ...base, ...labels, kind: 'graded', result: 'needs_remediation', earned: 2, total: 6 },
    { title: '🔁 Learner4 — U.S. Atlas: New York', message: '2 of 6 correct — retake is on the receipt', channel: 'School needs you' }],
  ['review', { ...base, ...labels, kind: 'review', pendingReview: 2, reasons: ['ambiguous'] },
    { title: '👀 Learner4 — U.S. Atlas: New York', message: "2 answers need a grown-up's check — two answers filled in" }],
  ['partial', { ...base, ...labels, kind: 'partial', blankRows: [4, 6], ambiguousRows: [] },
    { title: '⚠️ Learner4 — U.S. Atlas: New York', message: 'Rows 4 and 6 blank — fill in and rescan' }],
  ['partial, double mark', { ...base, ...labels, kind: 'partial', blankRows: [], ambiguousRows: [3] },
    { message: 'Row 3 has two marks — fill in and rescan' }],
  ['unmarked, alone', { testId: '5278294', kind: 'unmarked', rowRanges: [{ start: 34, end: 39 }], otherWorkGraded: false },
    { title: '⚠️ Unknown card — School card', message: "Nothing new was marked on this card (rows 34–39) — fill in today's rows and rescan" }],
  ['unresolved, known code', { testId: '1', kind: 'unresolved', code: 'CARD_ID_UNREADABLE' },
    { title: '⚠️ Unknown card — School card', message: "The card number couldn't be read — rescan the card" }],
  ['refused, unknown code', { ...base, ...labels, kind: 'refused', code: 'SOMETHING_NEW' },
    { message: "Card couldn't be graded — check the School teacher view" }],
  ['piano', { learnerId: 'user_4', child: 'Learner4', kind: 'piano', lesson: 'How to Play “Lavender’s Blue”', studyDay: '2026-09-21', unitProgress: { label: 'Folk Songs', completed: 3, total: 8 } },
    { title: '🎹 Learner4 — How to Play “Lavender’s Blue”', message: 'Piano lesson done · Folk Songs: 3 of 8 lessons', channel: 'School progress' }],
  ['piano, lesson title ending in ?', { learnerId: 'user_4', child: 'Learner4', kind: 'piano', lesson: 'What Are Flats in Music?' },
    { title: '🎹 Learner4 — What Are Flats in Music?', message: 'Piano lesson done' }],
];

describe('composeSchoolPush — catalog', () => {
  it.each(CASES)('%s', (_name, event, expected) => {
    const push = composeSchoolPush(event);
    if (expected.title) expect(push.title).toBe(expected.title);
    if (expected.message) expect(push.message).toBe(expected.message);
    if (expected.channel) expect(push.data.channel).toBe(expected.channel);
  });

  it.each(CASES)('%s renders without defects', (_name, event) => {
    const push = composeSchoolPush(event);
    expect(findPushTextDefects(push.title)).toEqual([]);
    expect(findPushTextDefects(push.message)).toEqual([]);
  });
});

describe('composeSchoolPush — suppression and fallbacks', () => {
  it('sends nothing for an unmarked old record when other work on the card graded', () => {
    expect(composeSchoolPush({ testId: '1', kind: 'unmarked', otherWorkGraded: true })).toBeNull();
  });
  it('sends nothing for an unknown kind', () => {
    expect(composeSchoolPush({ kind: 'nope' })).toBeNull();
  });
  it('never renders None when every label is missing', () => {
    const push = composeSchoolPush({ kind: 'graded', result: 'passed', earned: null, total: null });
    expect(push.title).toBe('✅ School card');
    expect(push.message).toBe('Passed');
  });
});

describe('composeSchoolPush — delivery metadata', () => {
  it('tags by session so a rescan replaces the earlier push, grouped per learner', () => {
    const partial = composeSchoolPush({ ...base, kind: 'partial', blankRows: [4] });
    const passed = composeSchoolPush({ ...base, kind: 'graded', result: 'passed', earned: 6, total: 6 });
    expect(partial.data.tag).toBe('school-user_4-ses_a');
    expect(passed.data.tag).toBe(partial.data.tag);
    expect(passed.data.group).toBe('school-user_4');
  });
  it('falls back to the card id when there is no session', () => {
    expect(composeSchoolPush({ testId: '9', kind: 'unresolved', code: 'dead_card' }).data)
      .toMatchObject({ tag: 'school-card-9', group: 'school', channel: 'School needs you', importance: 'high' });
  });
  it('tags a piano lesson per learner per study day', () => {
    expect(composeSchoolPush({ learnerId: 'user_4', kind: 'piano', lesson: 'Sharps', studyDay: '2026-09-04' }).data.tag)
      .toBe('school-user_4-piano-2026-09-04');
  });
});
```

**Step 2: Run the test to confirm it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs backend/src/2_domains/school/notifications/schoolPush.test.mjs`
Expected: FAIL (module not found)

**Step 3: Implement**

```js
/**
 * The phone's copy of a school event (design:
 * docs/_wip/plans/2026-09-22-household-push-notifications-design.md §1).
 *
 * Title: `{emoji} {Child} — {Course}: {Lesson}`. Body: one plain line, no
 * percentages, no ids, no trailing period. Returns null when the phone
 * should hear nothing. The room siren is decided elsewhere (the HA script
 * branches on `result`), so a null here never silences the room.
 */
import { formatStudyDay, pushData } from '#domains/notification/push/pushText.mjs';
import { rowList } from '../documents/scanNotices.mjs';

const LANES = {
  progress: { channel: 'School progress', importance: 'low' },
  needsYou: { channel: 'School needs you', importance: 'high' },
};

const CODE_TEXT = {
  CARD_ID_UNREADABLE: "The card number couldn't be read — rescan the card",
  OMR_COLUMN_COUNT: "The reader couldn't line up the card — rescan it",
  unknown_card: "This card isn't one School printed — check it's the right card",
  dead_card: 'This card was already retired — print a fresh one',
  ALLOCATION_ROW_MAPPING_DRIFT: "The card's rows didn't match its worksheet — check the School teacher view",
  SCAN_ROW_PLAN_INVALID: "The card's rows didn't match its worksheet — check the School teacher view",
};
const CODE_FALLBACK = "Card couldn't be graded — check the School teacher view";

const REVIEW_REASON = {
  'key-alignment-suspected': 'answers may be on the wrong rows',
  ambiguous: 'two answers filled in',
  free_response: 'written answers to grade',
};

const isCount = (value) => Number.isInteger(value) && value >= 0;
const scoreText = (earned, total) => (isCount(earned) && isCount(total) && total > 0
  ? `${earned} of ${total} correct`
  : null);

function lateSuffix({ studyDay, today }) {
  if (!studyDay || !today || studyDay >= today) return '';
  const day = formatStudyDay(studyDay);
  return day ? ` · from ${day}` : '';
}

function titleOf(emoji, { child, course, lesson }, unknownChild) {
  const subject = [course, lesson].filter(Boolean).join(': ') || 'School card';
  const who = child ?? (unknownChild ? 'Unknown card' : null);
  return who ? `${emoji} ${who} — ${subject}` : `${emoji} ${subject}`;
}

function metadata(event, lane, key) {
  return pushData({
    ...LANES[lane],
    tag: event.learnerId ? `school-${event.learnerId}-${key}` : `school-card-${key}`,
    group: event.learnerId ? `school-${event.learnerId}` : 'school',
  });
}

function push(emoji, event, message, lane, { unknownChild = false } = {}) {
  const key = event.sessionId ?? event.testId ?? 'unknown';
  return { title: titleOf(emoji, event, unknownChild), message, data: metadata(event, lane, key) };
}

export function composeSchoolPush(event = {}) {
  switch (event.kind) {
    case 'graded': {
      const score = scoreText(event.earned, event.total);
      const late = lateSuffix(event);
      if (event.result === 'needs_remediation') {
        return push('🔁', event, `${score ?? 'Not passed yet'} — retake is on the receipt${late}`, 'needsYou');
      }
      const body = event.retake ? `Retake: ${score ?? 'passed'}` : (score ?? 'Passed');
      return push('✅', event, `${body}${late}`, 'progress');
    }
    case 'review': {
      const count = isCount(event.pendingReview) && event.pendingReview > 0 ? event.pendingReview : null;
      const what = count === 1 ? "1 answer needs a grown-up's check"
        : count ? `${count} answers need a grown-up's check`
          : "Answers need a grown-up's check";
      const reason = (Array.isArray(event.reasons) ? event.reasons : [])
        .map((code) => REVIEW_REASON[code]).find(Boolean);
      return push('👀', event, reason ? `${what} — ${reason}` : what, 'needsYou');
    }
    case 'partial': {
      const blanks = rowList(event.blankRows);
      const doubles = rowList(event.ambiguousRows);
      const parts = [];
      if (blanks) parts.push(`${blanks} blank`);
      if (doubles) parts.push(`${doubles} ${doubles.startsWith('Rows') ? 'have' : 'has'} two marks`);
      const body = parts.length ? `${parts.join(', ')} — fill in and rescan` : 'Not finished — fill in and rescan';
      return push('⚠️', event, body, 'needsYou', { unknownChild: true });
    }
    case 'unmarked': {
      if (event.otherWorkGraded) return null;
      const ranges = (Array.isArray(event.rowRanges) ? event.rowRanges : [])
        .filter((range) => isCount(range?.start) && isCount(range?.end))
        .map((range) => (range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`));
      const where = ranges.length ? ` (rows ${ranges.join(', ')})` : '';
      return push('⚠️', event, `Nothing new was marked on this card${where} — fill in today's rows and rescan`,
        'needsYou', { unknownChild: true });
    }
    case 'unresolved':
    case 'refused':
      return push('⚠️', event, CODE_TEXT[event.code] ?? CODE_FALLBACK, 'needsYou', { unknownChild: true });
    case 'piano': {
      const unit = event.unitProgress;
      const where = unit && isCount(unit.completed) && isCount(unit.total) && unit.total > 0
        ? `${unit.label ? `${unit.label}: ` : ''}${unit.completed} of ${unit.total} lessons`
        : null;
      const lesson = event.lesson ?? 'Piano lesson';
      return {
        title: event.child ? `🎹 ${event.child} — ${lesson}` : `🎹 ${lesson}`,
        message: ['Piano lesson done', where].filter(Boolean).join(' · '),
        data: metadata(event, 'progress', `piano-${event.studyDay ?? 'today'}`),
      };
    }
    default:
      return null;
  }
}

export default composeSchoolPush;
```

**Step 4: Run the test to confirm it passes.** Expected: PASS.

**Step 5: Run the layer audit** (domains may not read the clock or import adapters):
`frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/tooling/auditLayerImports.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/2_domains/school/notifications/
git commit -m "feat(school): compose finished push text for every school outcome"
```

---

### Task 3: Hook adapter forwards `notification`

**Files:**
- Modify: `backend/src/1_adapters/school/SchoolGradingHookAdapter.mjs` (`toVariables`, ~line 36)
- Test: `tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs`

**Step 1: Write the failing tests.** Add to the existing test file, reusing its `makeAdapter` and `GRADED`. Also update any existing assertion that lists the exact variable key set so that it includes `notification`.

```js
it('forwards a composed notification verbatim', async () => {
  const { adapter, calls } = makeAdapter();
  const notification = { title: '✅ Learner4 — Atlas: Ohio', message: '6 of 6 correct', data: { tag: 't' } };
  await adapter.fire({ ...GRADED, notification });
  expect(calls[0].data.notification).toEqual(notification);
});

it('sends notification: null when none was composed', async () => {
  const { adapter, calls } = makeAdapter();
  await adapter.fire(GRADED);
  expect(calls[0].data).toHaveProperty('notification', null);
});
```

**Step 2: Run the tests to confirm they fail.**
`frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs`

**Step 3: Implement.** In `toVariables`, add after `lesson`:

```js
    // The finished phone copy (`2_domains/school/notifications/schoolPush.mjs`).
    // Forwarded untouched: the HA script relays it and never templates it.
    // null = "no push for this event"; the siren still branches on `result`.
    notification: o.notification ?? null,
```

Update the adapter's header comment (the "11-key" wording) to say the variable set includes `notification`.

**Step 4: Run the tests to confirm they pass.**

**Step 5: Commit**

```bash
git add backend/src/1_adapters/school/SchoolGradingHookAdapter.mjs tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs
git commit -m "feat(school): grading hook forwards the composed notification"
```

---

### Task 4: Settling a session reports retake and study day

**Files:**
- Modify: `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs`, the object returned by `#settle` (~line 581)
- Test: find the existing CloseSessionOutcome test (`grep -rln "CloseSessionOutcome" backend/src tests --include='*.test.mjs'`) and add to it

**Step 1: Write the failing test.** Using the existing test's harness, settle a session whose `session.created` event carries `remediationOf: 'ses_parent'` and `studyDay: '2026-09-14'`. Assert that the result includes `remediationOf: 'ses_parent', studyDay: '2026-09-14'`. Settle an ordinary session and assert `remediationOf: null`.

**Step 2: Run it to confirm it fails.**

**Step 3: Implement.** In the object `#settle` returns, next to `percent: state.gradedPercent,`, add:

```js
      // For the phone copy: a retake reads "Retake: 3 of 3", and work from a
      // past study day carries its date. Both are facts of the session.
      remediationOf: state.remediationOf ?? null,
      studyDay: state.studyDay ?? null,
```

**Step 4: Run it to confirm it passes.** Then run every CloseSessionOutcome test file to confirm nothing else broke.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs <the test file>
git commit -m "feat(school): settled outcome reports retake parent and study day"
```

---

### Task 5: Scan consumer composes the push at every hook fire

**Files:**
- Modify: `backend/src/3_applications/school/workflows/SchoolPrintScanConsumer.mjs`
- Create test: `backend/src/3_applications/school/workflows/SchoolPrintScanConsumer.push.test.mjs`. Model its harness on `SchoolPrintScanConsumer.slip.test.mjs` (same `settle`, `row`, `southDakota()` fixture, and `realtime` fake) and add a recording `gradingHook: { fire: (o) => { fired.push(o); } }`.

**New optional deps** (add to the destructured params and to the JSDoc):
- `curriculum = null`: `{ getWork(id) }`, the school catalog, for course labels.
- `studentName = null`: `(learnerId) => string|null|Promise`, the display name.
- `today = null`: `() => 'YYYY-MM-DD'`, the household study day.

**Step 1: Write the failing tests.** Wire `printDocuments.getPublished` to return `{ title: 'South Dakota' }`, `curriculum.getWork('civilization/atlas')` to return `{ title: 'United States Regions and States', short_title: 'U.S. Atlas' }`, `studentName: (id) => (id === 'user_4' ? 'Learner4' : null)`, and `today: () => '2026-09-15'`. Give the `southDakota()` card `subjectId: 'civilization', courseId: 'atlas'`.

1. **partial-scan** (`recordOutcome` → `{ session: { reason: 'partial-scan', sessionId: 'ses_4jqdgpr5b3' }, curriculum: { subjectId: 'civilization', courseId: 'atlas' } }`). Expect `fired[0].notification` to be:
   `{ title: '⚠️ Learner4 — U.S. Atlas: South Dakota', message: 'Row 33 blank — fill in and rescan' }`, with `data.tag === 'school-user_4-ses_4jqdgpr5b3'`.
2. **graded + settle** (recordOutcome → `{ session: { advancedTo: 'graded', sessionId: 'ses_4jqdgpr5b3', percent: 83.33, correctCount: 5, totalCount: 6 }, curriculum: {...} }`; `closeSessionOutcome.execute` → `{ result: 'passed', printed: true, remediationOf: null, studyDay: '2026-09-14' }`). Expect title `'✅ Learner4 — U.S. Atlas: South Dakota'` and message `'5 of 6 correct · from Mon Sep 14'`. Read the existing graded branch condition first (`advancedTo`/`reason` checks near line 540) and build the fake to satisfy it.
3. **Partial then Passed collapse:** tests 1 and 2 produce the same `data.tag`. Assert this explicitly.
4. **Unmarked old record with graded work:** `resolveCardScan` returns `{ results: [southDakota()], silentLiveRecords: [{ learnerId: 'user_4', rowRange: { start: 34, end: 39 } }] }`, and the graded path from test 2 runs. The first fire (`code: 'live_record_unmarked'`) has `notification: null`.
5. **Unmarked record alone:** `results: []` with the same `silentLiveRecords`. The fire has title `'⚠️ Learner4 — School card'` and a message containing `(rows 34–39)`.
6. **Unresolved:** `resolveCardScan` returns `{ error: { code: 'CARD_ID_UNREADABLE' } }`. The notification message is `"The card number couldn't be read — rescan the card"`.
7. **Missing deps degrade:** with no `curriculum`/`studentName`/`today`, a graded fire still has a notification whose title and message pass `findPushTextDefects(...) → []`.
8. **Compose failure:** make `studentName` throw. The hook still fires with the SAME outcome's copy without labels: a passed sheet reads `✅ School card` / `5 of 6 correct`, and never "couldn't be graded". `logger.warn` receives `school.push.compose-failed`. Unmarked-with-graded-work stays `null` even when a lookup throws. *(Changed after code review. The first version fell back to generic "unresolved" copy, which paged a parent that a passed sheet had failed, and broke suppression.)*

**Step 2: Run them to confirm they fail.**
`frontend/node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/school/workflows/SchoolPrintScanConsumer.push.test.mjs`

**Step 3: Implement.**

a) Imports at the top:

```js
import { composeSchoolPush } from '#domains/school/notifications/schoolPush.mjs';
import { courseDisplay } from '#domains/school/curriculum/display.mjs';
```

b) Inside `onPayload`, next to `titleFor`, add:

```js
    /**
     * The phone copy for one hook fire. Labels are best-effort (a missing
     * catalog entry drops that clause, never prints an id); a failure here
     * falls back to generic copy and can never block the fire or grading.
     */
    const pushFor = async (event, card = null, curriculumIds = null) => {
      try {
        const subjectId = curriculumIds?.subjectId ?? card?.subjectId ?? null;
        const courseId = curriculumIds?.courseId ?? card?.courseId ?? null;
        let course = null;
        if (subjectId && courseId && curriculum?.getWork) {
          const work = await curriculum.getWork(`${subjectId}/${courseId}`);
          course = work ? courseDisplay({ work }).shortTitle : null;
        }
        const learnerId = event.learnerId ?? card?.learnerId ?? null;
        const child = learnerId && studentName ? ((await studentName(learnerId)) ?? null) : null;
        const lesson = card ? await titleFor(card) : null;
        const notification = composeSchoolPush({
          testId, learnerId, child, course, lesson, today: today?.() ?? null, ...event,
        });
        if (notification) logger.debug?.('school.push.composed', { testId, kind: event.kind, tag: notification.data?.tag ?? null });
        else logger.info?.('school.push.suppressed', { testId, kind: event.kind, reason: event.kind === 'unmarked' ? 'unmarked-record-with-graded-work' : 'no-copy' });
        return notification;
      } catch (err) {
        logger.warn?.('school.push.compose-failed', { testId, kind: event.kind, error: err.message });
        // Same outcome, no labels; generic copy only if even that throws.
        return fallbackPush(event, card);
      }
    };
```

c) At each of the eight `gradingHook?.fire({...})` sites, compute the notification first and add `notification` to the fired object. Keep every existing key exactly as it is.

| Site (current line) | Add before the fire | Event passed to `pushFor` |
|---|---|---|
| ~259 `unresolved`, `outcome.error.code` | `const notification = await pushFor(...)` | `{ kind: 'unresolved', code: outcome.error.code }` |
| ~326 `unknown_card` | same | `{ kind: 'unresolved', code: 'unknown_card' }` |
| ~357 `dead_card` | same | `{ kind: 'unresolved', code: 'dead_card' }` |
| ~381 `live_record_unmarked` | same | `{ kind: 'unmarked', learnerId: outcome.silentLiveRecords[0]?.learnerId ?? null, rowRanges: outcome.silentLiveRecords.map((r) => r.rowRange), otherWorkGraded: Boolean(outcome.results?.length) }` |
| ~484 `refused` | same, pass `card` | `{ kind: 'refused', code: card.error.code, learnerId: card.learnerId ?? null }` |
| ~651 graded | same, pass `card, sectionOutcome.curriculum` | `{ kind: 'graded', result: settledResult, earned, total, sessionId: sectionOutcome.session.sessionId, retake: settledRetake, studyDay: settledStudyDay }` |
| ~667 review | same, pass `card, sectionOutcome.curriculum` | `{ kind: 'review', sessionId: sectionOutcome.session.sessionId, pendingReview: sectionOutcome.session.pendingReview, reasons: sectionOutcome.session.reasons }` |
| ~720 partial_scan | same, pass `card, sectionOutcome?.curriculum` | `{ kind: 'partial', sessionId: sectionOutcome.session.sessionId, blankRows, ambiguousRows }` |

For the graded site, capture two more values from `closeSessionOutcome.execute` next to `settledResult`:

```js
                let settledRetake = false;
                let settledStudyDay = null;
                // …inside the try, after settledResult:
                settledRetake = Boolean(settled?.remediationOf);
                settledStudyDay = settled?.studyDay ?? null;
```

These sites sit inside `async` functions already; `await` is safe. The fire itself stays fire-and-forget: `Promise.resolve(gradingHook?.fire({...})).catch(() => {})`. When `gradingHook` is null, skip `pushFor` (`const notification = gradingHook ? await pushFor(...) : null;`) so a house without HA does no catalog reads.

**Step 4: Run the new tests, then every existing consumer test,** to confirm they all pass:

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/school/workflows/
```

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/workflows/SchoolPrintScanConsumer.mjs backend/src/3_applications/school/workflows/SchoolPrintScanConsumer.push.test.mjs
git commit -m "feat(school): scan consumer composes the phone copy for each hook fire"
```

---

### Task 6: Piano lesson bridge composes the push

**Files:**
- Modify: `backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs` (`#fireHook` ~line 395, and its call ~line 228)
- Test: find the existing bridge test (`grep -rln "PianoLessonCeremonyBridge" backend/src tests --include='*.test.mjs'`) and add to it

**Step 1: Write the failing test.** Using the existing harness, complete a lesson whose launcher `status()` returns:
- `progress: [{ scope: 'course', label: 'Course', measures: 'unit', completed: 2, total: 20 }, { scope: 'module', label: 'Folk Songs', measures: 'lesson', completed: 3, total: 8 }]`
- a completion lesson title `How to Play “Lavender’s Blue”`

Assert that the hook's `notification` is `{ title: '🎹 Learner4 — How to Play “Lavender’s Blue”', message: 'Piano lesson done · Folk Songs: 3 of 8 lessons' }` with `data.channel === 'School progress'`. Add a second case with no module row: the message is `'Piano lesson done'`. The `score` value must never appear in the notification.

**Step 2: Run it to confirm it fails.**

**Step 3: Implement.** Pass `studyDate` into `#fireHook` from the call site, and in `#fireHook`:

```js
import { composeSchoolPush } from '#domains/school/notifications/schoolPush.mjs';
// …
    // The unit row is the scale a child feels progress at (see the launcher's
    // #progress). `status.score` is COURSE completion, never a lesson score,
    // and is deliberately not shown.
    const unitRow = (status?.progress ?? []).find((row) => row?.scope === 'module') ?? null;
    const notification = composeSchoolPush({
      kind: 'piano', learnerId, child: student, lesson, studyDay: studyDate,
      unitProgress: unitRow ? { label: unitRow.label ?? null, completed: unitRow.completed, total: unitRow.total } : null,
    });
    await this.#hook.fire({ /* existing keys unchanged */, notification });
```

**Step 4: Run it to confirm it passes,** and run all bridge tests.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs <the test file>
git commit -m "feat(school): piano lesson push names the lesson and unit progress"
```

---

### Task 7: Composition: display names and the new consumer deps

**Files:**
- Modify: `backend/src/app.mjs` (the `resolveStudent` lambdas at ~4036 and ~4269; `createSchoolPrintScanConsumer({...})` at ~4277)
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (~1204 `resolveStudent`)

**Step 1: Replace the three `resolveStudent` lambdas.** Each currently reads
`(learnerId) => configService.getUserProfile?.(learnerId)?.name ?? learnerId`.
Profiles store `display_name` and have no `name`, so every push said `user_1`. Replace each with:

```js
resolveStudent: (learnerId) => personDisplayName(configService.getUserProfile?.(learnerId), learnerId) ?? learnerId,
```

Add `import { personDisplayName } from '#domains/notification/push/pushText.mjs';` with each file's other static imports. Check first: if `app.mjs` loads school modules with dynamic `await import(...)` in that region, follow the file's existing pattern.

**Step 2: Wire the consumer deps.** In the `createSchoolPrintScanConsumer({...})` call, add:

```js
        // Phone-copy labels (2026-09-22 push redesign): course short titles
        // from the catalog, display names, and today's study day so late
        // work can say which day it was for.
        curriculum: schoolLifecycle.stores.curriculum ?? null,
        studentName: (learnerId) => personDisplayName(configService.getUserProfile?.(learnerId), learnerId),
        today: () => studyDayForInstant(Date.now(), { timezone: configService.getHouseholdTimezone?.() ?? null }),
        // Bounds the label lookups (default 2s) so a hung catalog/name read can
        // never withhold the hook and, with it, the room siren.
        scheduler: new NodeAsyncScheduler(),
```

Import `studyDayForInstant` from `#domains/school/studyDay.mjs`. Before relying on it, confirm that `schoolLifecycle.stores.curriculum` exists (`grep -n "curriculum," backend/src/5_composition/modules/schoolLifecycle.mjs` near its `return`/`stores` spread) and that `getHouseholdTimezone()` accepts no argument (`backend/src/0_system/config/ConfigService.mjs:65`).

**Step 3: Verify it parses and the composition contracts hold:**

```bash
npm run check:parse
npm run test:composition-contracts
```

Expected: both pass. Do NOT boot the app.

**Step 4: Commit**

```bash
git add backend/src/app.mjs backend/src/5_composition/modules/schoolLifecycle.mjs
git commit -m "fix(school): pushes use display names; wire push labels into the scan consumer"
```

---

### Task 8: Kiosk shutdown push composed in the backend

**Files:**
- Create: `backend/src/2_domains/shutdown/shutdownPush.mjs` + `shutdownPush.test.mjs`
- Modify: `backend/src/3_applications/shutdown/ShutdownService.mjs` (constructor `timezone`; `activate` passes `notification`)
- Modify: `backend/src/3_applications/shutdown/ShutdownService.test.mjs` (uses `node:test`; keep that runner)
- Modify: `backend/src/app.mjs`: the `shutdownCue.announce` closure (~line 5297) forwards `notification` in `variables`, and `new ShutdownService({...})` gets `timezone: configService.getHouseholdTimezone?.() ?? null`

**Step 1: Write the failing domain test**

```js
import { describe, it, expect } from 'vitest';
import { composeKioskShutdownPush } from './shutdownPush.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

describe('composeKioskShutdownPush', () => {
  const push = composeKioskShutdownPush({
    lockedAt: '2026-08-28T00:43:29.185Z', lockedUntil: '2026-08-28T01:13:29.185Z', timezone: 'America/Los_Angeles',
  });
  it('says how long and until when, in local time', () => {
    expect(push.title).toBe('🔒 Kiosks locked — 30 min, until 6:13 PM');
    expect(push.message).toBe('Started from the shutdown tag');
    expect(findPushTextDefects(push.title)).toEqual([]);
  });
  it('replaces a second tap instead of ringing twice', () => {
    expect(push.data).toMatchObject({ tag: 'kiosk-shutdown', alert_once: true });
  });
  it('degrades without times', () => {
    expect(composeKioskShutdownPush({}).title).toBe('🔒 Kiosks locked');
  });
});
```

**Step 2: Run it to confirm it fails.**

**Step 3: Implement**

```js
/** The phone copy for a public-kiosk lockdown (push standard: local times, tag, no ids). */
import { formatClockTime, formatDuration, pushData } from '#domains/notification/push/pushText.mjs';

export function composeKioskShutdownPush({ lockedAt = null, lockedUntil = null, timezone = null } = {}) {
  const span = formatDuration(Date.parse(lockedUntil ?? '') - Date.parse(lockedAt ?? ''));
  const until = formatClockTime(lockedUntil, timezone);
  const detail = [span, until ? `until ${until}` : null].filter(Boolean).join(', ');
  return {
    title: detail ? `🔒 Kiosks locked — ${detail}` : '🔒 Kiosks locked',
    message: 'Started from the shutdown tag',
    data: pushData({ tag: 'kiosk-shutdown', alertOnce: true, channel: 'Household alerts', importance: 'high' }),
  };
}

export default composeKioskShutdownPush;
```

**Step 4: Run it to confirm it passes.**

**Step 5: ShutdownService.** Add `timezone = null` to the constructor (stored as `#timezone`). In `activate`, change the announce call to:

```js
    if (this.#cue?.announce) Promise.resolve(this.#cue.announce({
      lockedUntil: state.lockedUntil, source: 'nfc-shutdown',
      notification: composeKioskShutdownPush({ lockedAt: state.lockedAt, lockedUntil: state.lockedUntil, timezone: this.#timezone }),
    })).catch((error) => this.#logger.warn?.('shutdown.cue_failed', { error: error.message }));
```

Check `ShutdownState` exposes `lockedAt` (`backend/src/2_domains/shutdown/ShutdownState.mjs`). If it doesn't, use the ISO string `activate` already builds for `locked_at`.

Extend `ShutdownService.test.mjs`: construct with `timezone: 'America/Los_Angeles'` and a fixed `now`, and assert that `haCalls[0].notification.title` starts with `'🔒 Kiosks locked — 30 min, until'`.
Run: `node --test backend/src/3_applications/shutdown/ShutdownService.test.mjs`

**Step 6: `app.mjs`.** In `shutdownCue.announce`, destructure `notification` and add it to `variables: { locked_until: lockedUntil, source, notification: notification ?? null }`. Pass `timezone` into `new ShutdownService`. Run `npm run check:parse`.

**Step 7: Commit**

```bash
git add backend/src/2_domains/shutdown/shutdownPush.mjs backend/src/2_domains/shutdown/shutdownPush.test.mjs backend/src/3_applications/shutdown/ShutdownService.mjs backend/src/3_applications/shutdown/ShutdownService.test.mjs backend/src/app.mjs
git commit -m "feat(shutdown): kiosk lockdown push in local time, tagged so repeats collapse"
```

---

### Task 9: NFC, TV, story time and approval pushes meet the standard

**Files:**
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs` (~line 428 payload)
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` (`#notifyPowerFailure`, ~line 790)
- Modify: `backend/src/3_applications/school/workflows/NotifyReadingSessionFailure.mjs` + its test
- Modify: `backend/src/app.mjs` (~line 5201, `alertAdult`: route through `NotifyReadingSessionFailure`; TriggerDispatchService construction: add `locationLabel`)
- Modify: `backend/src/1_adapters/home-automation/donow/HaApprovalNotifier.mjs` (~line 72 `data`)
- Tests: the existing test file for each (find with `grep -rln "<ClassName>" backend/src tests --include='*.test.mjs'`). Every new assertion also checks `findPushTextDefects(title|message)` → `[]`.

**9a. Unknown NFC tag.** Add an optional constructor dep `locationLabel = null` (`(location, locationConfig) => string|null`). Replace the payload with:

```js
    const where = this.#locationLabel?.(location, locationConfig) ?? titleCaseId(location);
    const payload = {
      title: `🏷️ New tag tapped — ${where}`,
      message: 'Tap "Add note" to name it',
      data: pushData({
        tag: `nfc-${uid}`,
        alertOnce: true,
        actions: [{ /* unchanged: action `NFC_REPLY|${location}|${uid}` etc. */ }],
      }),
    };
```

The UID stays in the action payload, which the reply handler needs, and leaves the visible text. Test: `livingroom` with `locationLabel` returning `'Living Room'` → title `'🏷️ New tag tapped — Living Room'`; the tag is `nfc-<uid>`; the action string is unchanged. In `app.mjs`, wire `locationLabel: (location, cfg) => deviceServices.deviceService.get(cfg?.target)?.location ?? null`. Find the TriggerDispatchService construction with `grep -n "new TriggerDispatchService" backend/src/app.mjs backend/src/5_composition -r`.

**9b. TV failed.**

```js
      const name = device?.name ?? titleCaseId(deviceId);
      await this.#haGateway.callService('notify', notifyService, {
        title: `📺 ${name} didn't turn on`,
        message: "It didn't respond after a retry",
        data: pushData({ tag: `tv-${deviceId}`, alertOnce: true }),
      });
```

Test: a device with `name: 'Living Room TV'` → title `"📺 Living Room TV didn't turn on"`.

**9c. Story time.** `app.mjs` has a live inline copy of this push (`alertAdult`, ~5201), while `NotifyReadingSessionFailure` is only used by its own test. Make the class the single implementation:

- Constructor: add `studentName = null` and `deviceLabel = null`.
- `execute({ target, location, learnerId })`:

```js
    const child = learnerId ? ((await this.studentName?.(learnerId)) ?? titleCaseId(learnerId)) : null;
    const screen = (target ? this.deviceLabel?.(target) : null) ?? 'screen';
    await this.notifier.callService('notify', notificationTarget, {
      title: child ? `📖 ${child}'s story time didn't start` : "📖 Story time didn't start",
      message: `The ${screen} didn't respond`,
      data: pushData({ tag: `story-${target ?? location ?? 'screen'}`, alertOnce: true }),
    });
```

- In `app.mjs`, construct it once and set:
  `alertAdult: (args) => notifyReadingSessionFailure.execute(args)`, with
  - `notificationTargetForDevice: (id) => deviceServices.deviceService.get(id)?.notifyService ?? null`
  - `notifier: homeAutomationAdapters.haGateway`
  - `studentName` from `personDisplayName`
  - `deviceLabel: (id) => deviceServices.deviceService.get(id)?.name ?? null`
- Keep the existing guard: skip the send when there's no gateway.

Test: `user_4` with `studentName → 'Learner4'` and a device labelled `Living Room TV` → `"📖 Learner4's story time didn't start"` / `"The Living Room TV didn't respond"`.

**9d. Approval.** In `HaApprovalNotifier`'s `data`, add `tag: \`donow-${record.id}\`` and `alert_once: true` next to `ttl`. Comment: a re-send for the same pending request replaces the card silently instead of ringing twice. Test: `payload.data.data.tag === 'donow-<id>'`.

Run each touched test file, then `npm run check:parse`.

**Commit**

```bash
git add <each modified source + test file>
git commit -m "feat(notification): NFC, TV, story time and approval pushes use names, tags and alert_once"
```

---

### Task 10: HA scripts switch to relay mode (controller does this, over SSH)

This is a live Home Assistant edit, not repo code. It's done by the controlling session, not a subagent.

**Files (on the prod host):**
- `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/school_worksheet_scan_notification.yaml`
- `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/public_kiosk_shutdown_cue.yaml`

**Step 1: Back up each file** next to itself, as `<name>.yaml.bak-2026-09-22`.

**Step 2: Replace the `notify.mobile_app_kc_phone` step** in the school script with a three-way branch.
- `notification` present → relay it verbatim.
- `notification` explicitly null → no push (a suppressed event or a siren test).
- `notification` undefined → the old backend is still deployed, so send the legacy message, now with `default(..., true)` so `null` stops rendering as `None`.

This makes the HA change safe to land before the backend deploy.

```yaml
  - if:
      - condition: template
        value_template: "{{ notification is defined and notification is mapping }}"
    then:
      - service: notify.mobile_app_kc_phone
        data:
          title: "{{ notification.title }}"
          message: "{{ notification.message }}"
          data: "{{ notification.data | default({}, true) }}"
    else:
      - if:
          - condition: template
            value_template: "{{ notification is not defined }}"
        then:
          - service: notify.mobile_app_kc_phone
            data:
              title: "Worksheet {{ result | default('scan', true) | replace('_', ' ') | title }}"
              message: >-
                {{ student | default(learner_id | default('Unknown student', true), true) }} —
                {{ lesson | default(unit | default('Unknown lesson', true), true) }}.
```

Apply the same relay-or-legacy branch to the kiosk script. Its legacy branch keeps today's text with `default(..., true)`.

**Step 3: Reload and verify.**
- Reload: `ssh homeserver.local` → `curl` HA `POST /api/services/script/reload` with the token from `data/household/auth/homeassistant.yml`. Don't inline the token in a logged command; read it into a variable on the remote side.
- Check `script.school_worksheet_scan_notification` is still `off` (loaded, not errored), using `node cli/dscli.mjs ha state script.school_worksheet_scan_notification` from the main checkout.
- Fire a siren test with the new contract:
  `dscli ha call-service script school_worksheet_scan_notification --data '{"result":"passed","percent":100,"notification":null}' --allow-write`
- Confirm: the tone plays, and NO `notify` `call_service` event appears in the HA recorder for that minute. Use the audit's query, filtered to the last 5 minutes.

---

### Task 11: Documentation

**Files:**
- Create: `docs/reference/notifications/push-standard.md`. Include:
  - the five rules (design §3);
  - where the helpers live (`2_domains/notification/push/pushText.mjs`, `2_domains/school/notifications/schoolPush.mjs`, `2_domains/shutdown/shutdownPush.mjs`);
  - the school channel names and tag scheme;
  - the Android caveat: channel importance is fixed on first sight of a channel name;
  - the `notification` variable contract (object → relay; `null` → no push; undefined → legacy).
- Modify: `docs/runbooks/school/home-assistant-grading-hook.md`:
  - fix the §3 result list: the real values are `passed`, `needs_remediation`, `graded` (unsettled), `partial`, `review`, `unresolved`, `refused`, and `satisfied` (piano);
  - add `notification` to the variable table;
  - correct the "no copy of the script exists" claim: it lives in HA's `_includes/scripts/`;
  - change the siren-test command to pass `"notification": null`.
- Modify: `CLAUDE.md`: add a navigation row: `| Push notifications (text standard, school push copy, HA relay) | docs/reference/notifications/push-standard.md |`.
- Modify: `docs/_wip/plans/2026-09-22-household-push-notifications-design.md`: set Status to "implemented on feat/household-push-notifications", and note the replay-test change.

No hostnames, IPs or real names in any of these (use `{env.prod_host}`).

**Commit**

```bash
git add docs/reference/notifications/push-standard.md docs/runbooks/school/home-assistant-grading-hook.md CLAUDE.md docs/_wip/plans/2026-09-22-household-push-notifications-design.md docs/_wip/plans/2026-09-22-household-push-notifications.md docs/_wip/audits/2026-09-22-ha-push-notification-audit.md
git commit -m "docs(notification): push standard, grading-hook runbook, audit and design"
```

---

### Task 12: Course short titles (content data, controller over SSH)

Two courses in the audit have no `short_title`, so their titles would read `United States Regions and States` and `National Geographic Book of Mammals`. On the prod data tree (`data/content/school/`), add one line to each `_index.yml`, keeping a backup copy:

- `civilization/young-peoples-atlas-us/_index.yml` → `short_title: U.S. Atlas`
- `science/national-geographic-book-of-mammals/_index.yml` → `short_title: Mammals`

`courseDisplay` already prefers `short_title` everywhere it's used (receipts, agenda). Check with `grep -rn "courseDisplay\|shortTitle" backend/src --include='*.mjs'` that no surface depends on the long title.

---

### Final verification (controller)

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  backend/src/2_domains/notification backend/src/2_domains/school/notifications backend/src/2_domains/shutdown \
  backend/src/3_applications/school backend/src/3_applications/trigger backend/src/3_applications/devices \
  tests/isolated/adapter/school tests/unit/tooling/auditLayerImports.test.mjs
node --test backend/src/3_applications/shutdown/ShutdownService.test.mjs
npm run check:parse
npm run test:composition-contracts
```

All green. Then merge into `main` per CLAUDE.md (merge directly, delete the branch, and record it in `docs/_archive/deleted-branches.md`). Deploying is the user's step.
