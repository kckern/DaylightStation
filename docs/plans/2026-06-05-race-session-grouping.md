# Race-Session Grouping & Activity Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Virtually merge runs of consecutive no-video fitness sessions (e.g. cycle-game races) into a single "giant session," enrich each merged session with the games/races that happened inside it, and redesign the session card + detail view to show those activities as overlaid time-bands with seams and a game-specific poster + "{N} races" label.

**Architecture:** Pure-derived, read-time grouping in the backend (`SessionService` consumers get virtual sessions; nothing on disk changes). A backend `ActivityRegistry` of providers cross-references each game's own data files (e.g. `cycle-races/<date>/*.yml`) to a session's time window. A frontend `fitnessActivityRegistry` maps an activity `type` to presentation (label, poster, overlay component). Existing physical `mergeSessions` (the video-resume path) is left untouched.

**Tech Stack:** Node ESM (`.mjs`) backend with DDD layers (`#domains`, `#apps`, `#api`); Express router; React/JSX frontend (Mantine); Vitest for both.

**Test command (both back & front specs):**
```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>
```

---

## Design decisions (locked during brainstorming)

- **Virtual / view-time grouping.** Originals stay on disk; grouping is reversible and computed on read.
- **A group breaks (new session starts) when the next session:** (a) has `media.primary` — a video session stands alone *and* separates; (b) crosses local calendar day; (c) starts **>4h** after the previous member ended; (d) has a roster **fully disjoint** from the running group's **union** of riders.
- **Split: backend owns data** (grouping + race cross-reference, returning `activities:[…]` + `segments:[…]`), **frontend owns assets** (label strings, poster images, overlay styling) via a registry keyed on activity `type`.
- **UTC footgun:** `cycle-races/*.yml` stores `race.date` as a **UTC ISO string** while folder/filename/sessions are **local**. The provider is the *single* place that parses `race.date` → epoch ms, so the skew never leaks into bucketing.
- **Seams:** each segment carries `gapBeforeMs`; the timeline compresses idle gaps and draws a seam divider between segments.

---

## Phase A — Backend: grouping + activity enrichment (powers the merged LIST)

### Task A1: Pure `groupSessions` domain function

**Files:**
- Create: `backend/src/2_domains/fitness/services/groupSessions.mjs`
- Test: `backend/src/2_domains/fitness/services/groupSessions.test.mjs`

Operates on **session summary** objects as returned by `SessionService.listSessionsInRange` (shape seen in the live API):
```
{ sessionId, date:'YYYY-MM-DD', startTime:<ms>, durationMs, participants:{ id:{displayName} },
  media:{primary:{…}}|null, totalCoins, maxSufferScore, stravaActivityId, strava, voiceMemos, … }
```

**Step 1: Write the failing test.** Use a fixture mirroring today's 7 sessions (2026-06-05):

```js
import { describe, it, expect } from 'vitest';
import { groupSessions, GROUP_MAX_GAP_MS } from './groupSessions.mjs';

const H = (h, m) => Date.parse(`2026-06-05T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-07:00`);
const sess = (id, start, durMin, riders, media = null, coins = 0) => ({
  sessionId: id, date: '2026-06-05', startTime: start, durationMs: durMin * 60000,
  participants: Object.fromEntries(riders.map(r => [r, { displayName: r }])), media, totalCoins: coins,
});

const today = [
  sess('s1', H(14,54), 5.5, ['milo'], null, 60),
  sess('s2', H(16,12), 10,  ['milo','alan'], null, 8),
  sess('s3', H(16,22), 37.5,['alan','milo'], null, 1139),
  sess('s4', H(16,59), 12.4,['milo','alan'], null, 466),
  sess('s5', H(17,19), 9.9, ['felix'], null, 151),
  sess('s6', H(18,35), 8,   ['alan','milo'], null, 194),
  sess('s7', H(19,10), 46.4,['kckern','milo','alan','felix','soren'],
       { primary: { contentId: 'plex:674286', title: 'Looney Tunes Racing' } }, 2745),
];

describe('groupSessions', () => {
  it('merges the no-video afternoon runs and leaves the video session standalone', () => {
    const groups = groupSessions(today);
    // s5 (felix only) is disjoint from running union {milo,alan} -> its own group
    // s6 (alan,milo) overlaps the s1..s4 union again -> NEW group (s5 broke the chain)
    // s7 has video -> standalone
    const ids = groups.map(g => g.segments.map(x => x.sessionId));
    expect(ids).toEqual([['s1','s2','s3','s4'], ['s5'], ['s6'], ['s7']]);
  });

  it('flags video groups and sums coins + unions rosters', () => {
    const [g1] = groupSessions(today);
    expect(g1.id).toBe('group:s1');
    expect(g1.isGroup).toBe(true);
    expect(g1.totalCoins).toBe(60 + 8 + 1139 + 466);
    expect(Object.keys(g1.participants).sort()).toEqual(['alan','milo']);
    expect(g1.media).toBeNull();
    expect(g1.segments[0].gapBeforeMs).toBe(0);
    expect(g1.segments[1].gapBeforeMs).toBeGreaterThan(0);
  });

  it('breaks the chain when the gap exceeds the ceiling', () => {
    const far = [...today.slice(0,1),
      sess('late', today[0].startTime + GROUP_MAX_GAP_MS + 60000, 5, ['milo'])];
    expect(groupSessions(far).length).toBe(2);
  });

  it('breaks across calendar days', () => {
    const nextDay = sess('d2', Date.parse('2026-06-06T08:00:00-07:00'), 5, ['milo']);
    expect(groupSessions([today[0], { ...nextDay, date: '2026-06-06' }]).length).toBe(2);
  });
});
```

> Note the **roster-chain subtlety the test pins down:** the running union is reset when a group breaks. After `s5` (felix) breaks the `s1..s4` block, `s6` is compared against the *fresh* union (just `s5`'s `{felix}`) — disjoint — so `s6` starts its own group. This is intended: a disjoint session is both a member-of-its-own-group and a hard separator.

**Step 2: Run it — expect FAIL** (module not found).

**Step 3: Implement** `groupSessions.mjs`:

```js
export const GROUP_MAX_GAP_MS = 4 * 60 * 60 * 1000; // 4h ceiling

const rosterSet = (s) => new Set(Object.keys(s.participants || {}));
const hasVideo  = (s) => !!(s.media && s.media.primary);
const disjoint  = (a, b) => { for (const x of b) if (a.has(x)) return false; return true; };

export function groupSessions(sessions, { maxGapMs = GROUP_MAX_GAP_MS } = {}) {
  const sorted = [...(sessions || [])].sort((a, b) => a.startTime - b.startTime);
  const groups = [];
  let cur = null, union = null;

  for (const s of sorted) {
    const startMs = s.startTime;
    const endMs   = s.startTime + (s.durationMs || 0);
    const newRoster = rosterSet(s);

    const mustBreak =
      !cur ||
      cur._hasVideo || hasVideo(s) ||
      s.date !== cur.date ||
      (startMs - cur._lastEndMs) > maxGapMs ||
      disjoint(union, newRoster);

    if (mustBreak) {
      cur = { id: `group:${s.sessionId}`, isGroup: true, date: s.date,
              startTime: startMs, endTime: endMs, segments: [], _lastEndMs: endMs,
              _hasVideo: hasVideo(s), _coins: 0 };
      union = new Set(newRoster);
      groups.push(cur);
    } else {
      for (const r of newRoster) union.add(r);
      cur.endTime = endMs;
      cur._lastEndMs = endMs;
    }

    cur.segments.push({
      sessionId: s.sessionId, start: startMs, end: endMs, durationMs: s.durationMs || 0,
      participants: s.participants || {}, coins: s.totalCoins || 0,
      gapBeforeMs: cur.segments.length === 0 ? 0 : Math.max(0, startMs - cur._prevEnd),
      media: s.media || null, stravaActivityId: s.stravaActivityId ?? null,
    });
    cur._prevEnd = endMs;
    cur._coins += s.totalCoins || 0;
    cur._union = union;
  }

  return groups.map((g) => finalize(g));
}

function finalize(g) {
  const participants = {};
  for (const r of g._union) {
    const seg = g.segments.find((x) => x.participants[r]);
    participants[r] = seg ? seg.participants[r] : { displayName: r };
  }
  const single = g.segments.length === 1;
  return {
    id: single ? g.segments[0].sessionId : g.id, // keep real id for un-merged singletons
    isGroup: !single,
    date: g.date,
    startTime: g.startTime,
    endTime: g.endTime,
    durationMs: g.endTime - g.startTime,
    segments: g.segments,
    participants,
    totalCoins: g._coins,
    media: g._hasVideo ? g.segments[0].media : null,
    activities: [], // filled by SessionGroupingService (Task A3)
  };
}
```

**Step 4: Run — expect PASS.**
**Step 5: Commit** `feat(fitness): pure groupSessions domain fn (virtual no-video merge)`.

---

### Task A2: `ActivityRegistry` + `CycleGameProvider` (race cross-reference + UTC fix)

**Files:**
- Create: `backend/src/3_applications/fitness/activities/ActivityRegistry.mjs`
- Create: `backend/src/3_applications/fitness/activities/CycleGameProvider.mjs`
- Test: `backend/src/3_applications/fitness/activities/CycleGameProvider.test.mjs`

**Provider contract:**
```js
{
  type: 'cycle-game',
  // -> [{ startMs, endMs, participants:[id], meta:{ winnerId, distances:{id:m}, timeCapS, backgroundPlexId } }]
  async loadOverlapping(startMs, endMs, dateStr, householdId)
}
```

**Step 1: Failing test** (mock `cycleRaceService.listByDate`, assert UTC `race.date` → epoch + window filter):

```js
import { describe, it, expect } from 'vitest';
import { CycleGameProvider } from './CycleGameProvider.mjs';

const race = (id, utcIso, riders) => ({
  race: { id, date: utcIso, time_cap_s: 60, background_plex_id: 674141 },
  participants: Object.fromEntries(riders.map(([n, d], i) =>
    [n, { display_name: n, final_distance_m: d, placement: i + 1 }])),
});

const svc = {
  listByDate: async () => [
    race('r-morning', '2026-06-05T15:48:00Z', [['kckern', 0], ['felix', 0]]), // 08:48 PDT
    race('r-after',   '2026-06-05T23:22:37Z', [['milo', 215], ['alan', 222]]),// 16:22 PDT
  ],
};

describe('CycleGameProvider', () => {
  it('parses UTC race.date to epoch and filters to the window', async () => {
    const p = new CycleGameProvider({ cycleRaceService: svc });
    const start = Date.parse('2026-06-05T16:22:00-07:00');
    const end   = Date.parse('2026-06-05T16:59:00-07:00');
    const items = await p.loadOverlapping(start, end, '2026-06-05', 'household');
    expect(items.map(i => i.meta.raceId)).toEqual(['r-after']); // morning excluded
    expect(items[0].startMs).toBe(Date.parse('2026-06-05T23:22:37Z'));
    expect(items[0].meta.winnerId).toBe('milo');               // placement 1
    expect(items[0].participants.sort()).toEqual(['alan', 'milo']);
  });
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement.** `CycleGameProvider.mjs`:

```js
const WINDOW_SLACK_MS = 90 * 1000; // a race may start a touch before/after the session edge

// SINGLE place in the codebase that interprets the UTC race.date string.
export function raceEpochMs(record) {
  const ms = Date.parse(record?.race?.date);
  return Number.isFinite(ms) ? ms : null;
}

function toItem(record) {
  const startMs = raceEpochMs(record);
  if (startMs == null) return null;
  const parts = Object.entries(record.participants || {});
  const distances = {};
  let winnerId = null;
  for (const [id, p] of parts) {
    distances[id] = p.final_distance_m ?? 0;
    if (p.placement === 1) winnerId = id;
  }
  const capS = record?.race?.time_cap_s || 0;
  return {
    startMs,
    endMs: startMs + capS * 1000,
    participants: parts.map(([id]) => id),
    meta: { raceId: record?.race?.id, winnerId, distances,
            timeCapS: capS, backgroundPlexId: record?.race?.background_plex_id ?? null },
  };
}

export class CycleGameProvider {
  type = 'cycle-game';
  constructor({ cycleRaceService }) {
    if (!cycleRaceService) throw new Error('CycleGameProvider requires cycleRaceService');
    this.cycleRaceService = cycleRaceService;
  }
  async loadOverlapping(startMs, endMs, dateStr, householdId) {
    const records = (await this.cycleRaceService.listByDate(dateStr, householdId)) || [];
    return records
      .map(toItem)
      .filter((it) => it && it.startMs >= startMs - WINDOW_SLACK_MS && it.startMs <= endMs + WINDOW_SLACK_MS)
      .sort((a, b) => a.startMs - b.startMs);
  }
}
```

`ActivityRegistry.mjs`:
```js
export class ActivityRegistry {
  constructor() { this.providers = []; }
  register(provider) { this.providers.push(provider); return this; }
  async enrich(group, householdId) {
    const activities = [];
    for (const p of this.providers) {
      const items = await p.loadOverlapping(group.startTime, group.endTime, group.date, householdId);
      if (items.length) activities.push({ type: p.type, count: items.length, items });
    }
    return activities;
  }
}
```

**Step 4: Run — expect PASS.** **Step 5: Commit** `feat(fitness): ActivityRegistry + CycleGameProvider (UTC race.date centralized)`.

---

### Task A3: `SessionGroupingService` (group + enrich)

**Files:**
- Create: `backend/src/3_applications/fitness/services/SessionGroupingService.mjs`
- Test: `backend/src/3_applications/fitness/services/SessionGroupingService.test.mjs`

**Step 1: Failing test** — given the 7-session fixture + a stub registry that tags the afternoon group with 13 races, assert the first group gets `activities[0] = { type:'cycle-game', count:13 }` and the video group gets none.

**Step 2: Run — FAIL.**

**Step 3: Implement:**
```js
import { groupSessions } from '#domains/fitness/services/groupSessions.mjs';

export class SessionGroupingService {
  constructor({ activityRegistry, logger = console } = {}) {
    this.activityRegistry = activityRegistry || null;
    this.logger = logger;
  }
  async group(sessions, householdId, { enrich = true } = {}) {
    const groups = groupSessions(sessions);
    if (!enrich || !this.activityRegistry) return groups;
    for (const g of groups) {
      if (g.media) continue; // video sessions are not activity-enriched
      try { g.activities = await this.activityRegistry.enrich(g, householdId); }
      catch (e) { this.logger?.warn?.('fitness.group.enrich.failed', { id: g.id, error: e?.message }); }
    }
    return groups;
  }
}
```

**Step 4: Run — PASS.** **Step 5: Commit** `feat(fitness): SessionGroupingService (group + activity enrich)`.

---

### Task A4: Wire into bootstrap + `/sessions` list endpoint

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (`createFitnessServices`, ~line 884) — build registry + grouping service, export them.
- Modify: `backend/src/4_api/v1/routers/index.mjs` — pass `sessionGroupingService` into the fitness router.
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` — accept `sessionGroupingService = null` in the constructor (next to `cycleRaceService`, ~line 91) and apply it in **both** branches of `GET /sessions`.

**Step 1: Bootstrap** (after `cycleRaceService` is built, ~line 888):
```js
const activityRegistry = new ActivityRegistry()
  .register(new CycleGameProvider({ cycleRaceService }));
const sessionGroupingService = new SessionGroupingService({ activityRegistry, logger });
```
Add imports at top of `bootstrap.mjs` and include `sessionGroupingService` in the object `createFitnessServices` returns; thread it through to where the fitness router is constructed (mirror how `cycleRaceService` is already passed).

**Step 2: Router** — in `GET /sessions`, wrap the results. Add a `?group=none` escape hatch:
```js
const doGroup = sessionGroupingService && req.query.group !== 'none';
// Mode 1 (date):
let sessions = await sessionService.listSessionsByDate(date, household);
if (doGroup) sessions = await sessionGroupingService.group(sessions, household);
// Mode 2 (since): group BEFORE slicing to limit, so a merged session counts as one row
let sessions = await sessionService.listSessionsInRange(startDate, endDate, household);
if (doGroup) sessions = await sessionGroupingService.group(sessions, household);
sessions.sort((a, b) => b.startTime - a.startTime); // grouping returns ascending; list is desc
const limited = sessions.slice(0, maxLimit);
```

**Step 3 (manual verification):** start dev server, then:
```bash
curl -s 'http://localhost:3111/api/v1/fitness/sessions?since=2d&limit=50' \
 | python3 -c 'import json,sys; d=json.load(sys.stdin)["sessions"]; \
   print([(s["id"], s.get("isGroup"), [a["type"]+":"+str(a["count"]) for a in s.get("activities",[])]) for s in d if s["date"]=="2026-06-05"])'
```
Expected: the afternoon group shows `isGroup:true` with `cycle-game:NN`; the 19:10 Looney Tunes session is standalone with no activities; `?group=none` returns the original 7.

**Step 4: Commit** `feat(fitness): apply virtual grouping + activity enrichment to /sessions`.

> ⚠️ **Downstream guard:** other consumers read `s.sessionId`. Grouped objects expose `id` (and `segments[].sessionId`) but **no top-level `sessionId`**. In Task A4 also add `sessionId: g.isGroup ? null : g.id` in `finalize()` so existing list-rendering that reads `sessionId` for singletons keeps working, and audit `FitnessSessionsWidget`/`SessionBrowserApp` for `sessionId` access (handled in Phase B).

---

## Phase B — Frontend: activity registry + merged list card

### Task B1: `fitnessActivityRegistry`

**Files:**
- Create: `frontend/src/modules/Fitness/lib/activities/fitnessActivityRegistry.js`
- Create (placeholder asset): `frontend/src/modules/Fitness/widgets/_shared/posters/cycle-game.svg` (simple bike/coin motif, **Roboto Condensed** if any text — see memory `feedback_roboto_condensed_is_canon`; do **not** rasterize, keep vector — `feedback_no_rasterize_svgs`).
- Test: `frontend/src/modules/Fitness/lib/activities/fitnessActivityRegistry.test.js`

**Step 1: Failing test:**
```js
import { describe, it, expect } from 'vitest';
import { getActivityDisplay, primaryActivity } from './fitnessActivityRegistry.js';

describe('fitnessActivityRegistry', () => {
  it('labels cycle-game by race count', () => {
    const d = getActivityDisplay('cycle-game');
    expect(d.label(1)).toBe('1 race');
    expect(d.label(13)).toBe('13 races');
    expect(d.poster).toMatch(/cycle-game/);
  });
  it('picks the highest-count activity as primary', () => {
    const a = primaryActivity([{ type: 'cycle-game', count: 3 }]);
    expect(a.type).toBe('cycle-game');
  });
  it('returns null display for unknown types (graceful Workout fallback)', () => {
    expect(getActivityDisplay('nope')).toBeNull();
  });
});
```

**Step 2: Run — FAIL. Step 3: Implement:**
```js
import cycleGamePoster from '../../widgets/_shared/posters/cycle-game.svg';

const REGISTRY = {
  'cycle-game': {
    label: (n) => `${n} ${n === 1 ? 'race' : 'races'}`,
    poster: cycleGamePoster,
    accent: '#3ba776',
    overlay: 'race-bands', // overlay component key, resolved in Task D
  },
};

export function getActivityDisplay(type) { return REGISTRY[type] || null; }
export function primaryActivity(activities = []) {
  if (!activities.length) return null;
  return [...activities].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
}
```

**Step 4: Run — PASS. Step 5: Commit** `feat(fitness): frontend activity registry + cycle-game poster`.

---

### Task B2: Merged title + poster on the list card

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx` (title fallback at line ~193-194; poster placeholder `WorkoutPlaceholder` at ~26)
- Test: extend the widget's existing test (or add `FitnessSessionsWidget.activity.test.jsx`)

**Step 1: Failing test** — render a session with `media:null, activities:[{type:'cycle-game',count:12}]`; expect text `12 races` and the poster `<img>` (not the dumbbell placeholder).

**Step 2: Run — FAIL. Step 3: Implement** — compute the display title:
```js
import { getActivityDisplay, primaryActivity } from '@/modules/Fitness/lib/activities/fitnessActivityRegistry.js';
// inside the row render:
const act = !s.media?.primary ? primaryActivity(s.activities) : null;
const actDisplay = act ? getActivityDisplay(act.type) : null;
const title = pm?.title || s.strava?.name || (actDisplay ? actDisplay.label(act.count) : 'Workout');
// poster: actDisplay?.poster ? <img src={actDisplay.poster} … /> : <WorkoutPlaceholder />
```
Also show a small seam/segment hint when `s.isGroup` (e.g. `· {s.segments.length} blocks`). Use the logging framework for a debug event on first activity render if adding instrumentation (per CLAUDE.md logging rule).

**Step 4: Run — PASS. Step 5: Commit** `feat(fitness): list card shows "{N} races" + poster for game sessions`.

---

## Phase C — Backend: stitched detail for `group:` ids

### Task C1: Resolve `group:` in `GET /sessions/:sessionId`

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (detail handler, ~line 333)
- Add method: `SessionGroupingService.getGroupDetail(groupId, householdId)`
- Test: `SessionGroupingService.detail.test.mjs`

**Behavior:** when `:sessionId` starts with `group:`, re-derive the day's groups, find the matching one, load each member's **full** session (`sessionService.getSession(memberId, household, { decodeTimeline: true })`), and **concatenate timelines with gaps compressed**, recording seam offsets. Attach `activities` (with `items` as overlay bands, their `startMs` rebased onto the compressed axis).

**Compressed timeline model** (return shape additions):
```
session: {
  id, isGroup:true, segments:[{ sessionId, offsetMs, durationMs, gapBeforeMs }],
  seams:[{ atMs, gapMs }],         // positions on the compressed axis
  timeline:{ … concatenated series, gaps removed … },
  activities:[{ type, count, items:[{ startMs(rebased), endMs(rebased), … }] }],
}
```

Reuse `mergeTimelines(earlier, later, gapTicks)` from `#domains/fitness/services/TimelineService.mjs` **with `gapTicks = 0`** to butt segments together (no null filler), accumulating each segment's `offsetMs` so overlay bands and seams can be rebased. For singleton ids, fall through to the existing `sessionService.getSession` path unchanged.

**Steps:** (1) failing test stitching two member fixtures → expect concatenated length = sum of member tick counts, `seams.length === 1`, activity item `startMs` rebased into `[0, durationMs]`; (2) run FAIL; (3) implement; (4) run PASS; (5) commit `feat(fitness): stitched group detail with compressed seams`.

---

## Phase D — Frontend: timeline overlay (race bands + seams) + detail header

### Task D1: Race bands + seam dividers in `FitnessTimeline`

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx` (+ `.scss`)
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx` (title at line ~229; add poster card from registry)
- Test: `FitnessTimeline.activity.test.jsx`

**Step 1: Failing test** — render the timeline with `segments`/`seams`/`activities`; expect N `.race-band` elements positioned by `(startMs/durationMs)*100%` width, and `seams.length` `.timeline-seam` dividers.

**Step 2: Run — FAIL. Step 3: Implement:**
- Overlay layer absolutely-positioned over the existing chart x-axis (which already spans `0:00 → elapsed`). Each activity item → a `.race-band` rect: `left = startMs/durMs`, `width = (endMs-startMs)/durMs`. Tooltip: winner + per-rider distance from `item.meta`. Color by `registry.accent`; optionally tint by `winnerId`'s rider color.
- Each seam → a dashed vertical `.timeline-seam` at `seam.atMs/durMs` with a small `⌇ {fmtGap(gap)}` label (e.g. "⌇ 1h 14m").
- Detail header: `title = getActivityDisplay(primaryActivity(activities)?.type)?.label(count) || …existing…`; render the poster from the registry in the existing top-left card slot in place of the green dumbbell placeholder.
- Respect the canonical font (Roboto Condensed) and the Menu-animation note (this widget is **outside** `.menu-items-container`, so normal CSS transitions are fine — no Web Animations workaround needed).

**Step 4: Run — PASS. Step 5: Commit** `feat(fitness): overlay race bands + seams on session timeline + game poster`.

---

## Phase E — Docs & cleanup

### Task E1: Update docs
- Add `docs/reference/core/` note (or fitness reference) describing: virtual grouping rules, the activity registry contract (how to add a new game provider), and the `cycle-races` UTC-vs-local convention with the single `raceEpochMs` chokepoint.
- Update `docs/docs-last-updated.txt` marker per CLAUDE.md.
- Commit `docs(fitness): document race-session grouping + activity registry`.

---

## Verification checklist (before claiming done — superpowers:verification-before-completion)

- [ ] All new specs pass via the vitest command above (paste output).
- [ ] `curl …/sessions?since=2d` shows the afternoon merged group with `cycle-game:NN`, the Looney Tunes session standalone, and `?group=none` returns the raw 7.
- [ ] Detail for the `group:` id returns a stitched timeline with the right number of seams and rebased race bands.
- [ ] Run the app (skill: `run`/`verify`) and visually confirm: merged card titled "{N} races" with poster; timeline shows race bands + seams. Verify with a vision check, don't ask the user to eyeball (memory `feedback_dont_ask_check_yourself`).
- [ ] No `sessionId`-access regressions in the session browser for singletons.
- [ ] Do **not** commit/deploy automatically (CLAUDE.md) — leave for KC to review/merge.

---

## YAGNI / out of scope
- No physical merge or file rewrites (keep `mergeSessions` as the video-resume path only).
- No new game providers beyond `cycle-game` (the registry makes adding them trivial later).
- No fixing the morning-races-missing-from-sessions bug here (separate from grouping — those sessions simply never existed; track separately).
- No Strava re-upload / re-aggregation of merged groups in v1.
