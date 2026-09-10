import { isSchoolDay, namedDayOff } from '#domains/school/schoolCalendar.mjs';

const YESTERDAY_LIMIT = 4;
const RECENT_DAYS = 7;
/** Day groups the shelf can hold side by side on a living-room TV. */
const RECENT_DAY_GROUPS = 3;
/** Books within one day. A fourth cover is where the row stops being countable. */
const BOOKS_PER_DAY = 4;
/**
 * The streak wall: four weeks, so it draws as 7 columns x 4 rows. Longer reads
 * as a smear at sofa distance, and a month is the span a child can still point
 * at a square and remember the day.
 */
const STREAK_DAYS = 28;
const trimmed = value => typeof value === 'string' && value.trim() ? value.trim() : null;

function dayBefore(studyDay) {
  const midnight = Date.parse(`${studyDay}T00:00:00.000Z`);
  if (!Number.isFinite(midnight)) return null;
  return new Date(midnight - 86_400_000).toISOString().slice(0, 10);
}

export class ReadingApiService {
  #recordStoryRead; #sessions; #storyTime; #readingLog; #resolveLearner; #logger; #observations; #clock; #nowMs;
  #householdCalendar;
  constructor({ recordStoryRead, sessions, storyTime = null, readingLog = null, resolveLearner = null,
    householdCalendar = null,
    logger = console, observationStore = null, clock = () => new Date(), nowMs = Date.now } = {}) {
    if (!recordStoryRead) throw new Error('createReadingRouter requires recordStoryRead');
    if (!sessions) throw new Error('createReadingRouter requires a sessions store');
    this.#recordStoryRead = recordStoryRead; this.#sessions = sessions; this.#storyTime = storyTime;
    this.#readingLog = readingLog; this.#resolveLearner = resolveLearner; this.#logger = logger;
    this.#observations = observationStore; this.#clock = clock; this.#nowMs = nowMs;
    this.#householdCalendar = householdCalendar;
  }
  session(location) { return this.#sessions.snapshot(location); }
  acknowledge(location, proof) {
    const session = this.#sessions.acknowledge(location, proof);
    return { ok: Boolean(session), session };
  }
  async events(location, limit) {
    const session = this.#sessions.snapshot(location);
    const current = session.session;
    const now = this.#nowMs();
    const isoAge = value => {
      const at = Date.parse(value);
      return Number.isFinite(at) ? Math.max(0, now - at) : null;
    };
    const events = this.#observations?.list
      ? await this.#observations.list(location, { limit })
      : this.#sessions.observations(location, { limit });
    const visibleState = current?.state ?? (events.at(-1)?.type === 'closed' ? 'idle' : events.at(-1)?.state ?? 'unknown');
    const stateStart = events.filter((event, index) => event?.state === visibleState && events[index - 1]?.state !== visibleState).at(-1);
    return { ...session, ageMs: current ? isoAge(current.openedAt) : null,
      ackAgeMs: current?.acknowledgedAt ? isoAge(current.acknowledgedAt) : null,
      progressAgeMs: current?.progress?.at ? isoAge(current.progress.at) : null,
      visibleState, displayedSince: stateStart?.at ?? null, events };
  }
  progress({ location, sessionId, pickId, positionSec, durationSec, paused }) {
    const session = location ? this.#sessions.current(location) : null;
    if (!session || session.sessionId !== sessionId || session.pick?.pickId !== pickId) {
      return { kind: 'mismatch' };
    }
    const updated = this.#sessions.update(location, { progress: {
      positionSec: Number.isFinite(positionSec) ? positionSec : null,
      durationSec: Number.isFinite(durationSec) ? durationSec : null,
      paused: paused === true, at: this.#clock().toISOString(),
    } });
    return { kind: 'ok', session: updated };
  }
  async readStatus(learnerId, studyDay, pickId) {
    const read = await this.#readingLog?.findByPickId?.(learnerId, studyDay, pickId) ?? null;
    return { recorded: Boolean(read), read };
  }
  playing({ location, learnerId, contentId, pickId }) {
    const current = this.#sessions.current(location);
    const serverPick = current?.pick ?? null;
    if (serverPick?.pickId && serverPick.pickId !== pickId) return { kind: 'pick_mismatch' };
    const attributedLearnerId = serverPick?.learnerId ?? learnerId;
    const attributedContentId = serverPick?.contentId ?? contentId;
    const updated = this.#sessions.update(location, { state: 'reading',
      playing: { learnerId: attributedLearnerId, contentId: attributedContentId, pickId, at: this.#clock().toISOString() } });
    if (!updated) {
      this.#logger.info?.('school.reading.playing-no-session', { location, learnerId, contentId });
      return { kind: 'no_session' };
    }
    if (!attributedLearnerId) {
      this.#logger.warn?.('school.reading.playing-unattributed', { location, contentId, pickId,
        sessionLearnerId: updated.learnerId,
        consequence: 'the completion POST will be rejected and the read lost' });
    } else if (attributedLearnerId !== updated.learnerId) {
      this.#logger.info?.('school.reading.playing-learner-differs', { location, contentId, pickId,
        screenLearnerId: learnerId, sessionLearnerId: updated.learnerId,
        note: 'defense in depth: the story keeps its pick-time learner even if a legacy/direct caller changed the session' });
    }
    this.#logger.info?.('school.reading.playback-started', { location, learnerId: attributedLearnerId,
      contentId: attributedContentId, pickId, attributable: Boolean(attributedLearnerId) });
    return { kind: 'ok', state: updated.state, learnerId: updated.learnerId };
  }
  async read(body = {}) {
    const location = trimmed(body.location);
    const current = location ? this.#sessions.current(location) : null;
    const serverPick = location ? this.#sessions.current(location)?.pick ?? null : null;
    const requestPickId = trimmed(body.pickId);
    const requestSessionId = trimmed(body.sessionId);
    if (requestSessionId && (!current || current.sessionId !== requestSessionId || !serverPick)) {
      this.#logger.warn?.('school.reading.read-conflict', {
        reason: 'session-or-pick-expired', location,
        requestSessionId, currentSessionId: current?.sessionId ?? null,
        requestPickId, currentPickId: serverPick?.pickId ?? null,
        requestLearnerId: trimmed(body.learnerId), currentLearnerId: current?.learnerId ?? null,
        state: current?.state ?? null,
      });
      return { kind: 'session_expired' };
    }
    if (serverPick?.pickId && serverPick.pickId !== requestPickId) {
      this.#logger.warn?.('school.reading.read-conflict', {
        reason: 'pick-mismatch', location,
        requestSessionId, currentSessionId: current?.sessionId ?? null,
        requestPickId, currentPickId: serverPick.pickId,
        requestLearnerId: trimmed(body.learnerId), currentLearnerId: current?.learnerId ?? null,
        state: current?.state ?? null,
      });
      return { kind: 'pick_mismatch' };
    }
    let read;
    try {
      read = await this.#recordStoryRead.execute({ learnerId: serverPick?.learnerId ?? body.learnerId,
        contentId: serverPick?.contentId ?? trimmed(body.contentId), title: trimmed(body.title),
        tagUid: trimmed(body.tagUid), location: trimmed(body.location), pickId: serverPick?.pickId ?? requestPickId,
        studyDay: serverPick?.studyDay ?? null });
    } catch (err) {
      this.#logger.error?.('school.reading.read-rejected', { location, learnerId: body.learnerId ?? null,
        contentId: trimmed(body.contentId), pickId: trimmed(body.pickId), error: err?.message ?? String(err),
        consequence: 'the story played and the obligation did not move' });
      throw err;
    }
    const returning = location ? this.#sessions.beginReturn(location, { reason: 'story-finished' }) : null;
    return { kind: 'ok', read, presentation: returning?.presentation ?? null };
  }
  async summary(learnerId) {
    let status = null;
    try { status = (await this.#storyTime?.status?.({ userId: learnerId })) ?? null; }
    catch (err) { this.#logger.warn?.('school.reading.summary-status-failed', { learnerId, error: err.message }); }
    let yesterday = [];
    let recentDays = [];
    let streak = [];
    const studyDay = (() => { try { return this.#storyTime?.studyDay?.() ?? null; } catch { return null; } })();
    if (studyDay && this.#readingLog?.listForDay) {
      // ONE batch serves both views. The streak wall needs four weeks and the
      // recent shelf needs one; reading the window twice would double the file
      // I/O of every session open for the same rows.
      const days = [studyDay];
      while (days.length < STREAK_DAYS) {
        const prior = dayBefore(days.at(-1));
        if (!prior) break;
        days.push(prior);
      }
      const batches = await Promise.all(days.map(async (day) => {
        try {
          const rows = await this.#readingLog.listForDay(learnerId, day);
          return (Array.isArray(rows) ? rows : []).map((row, index) => ({ ...row, studyDay: day, _index: index }));
        } catch (err) {
          this.#logger.warn?.('school.reading.summary-history-failed', { learnerId, day, error: err.message });
          return [];
        }
      }));
      yesterday = (batches[1] ?? []).slice(0, YESTERDAY_LIMIT)
        .map(row => ({ title: row?.title ?? null, contentId: row?.contentId ?? null }));
      // Newest first. `at` is the real clock; the studyDay/index tiebreak only
      // matters for rows written without one. The SHELF looks at one week; the
      // streak below looks at the whole batch.
      const ordered = batches.slice(0, RECENT_DAYS).flat().sort((a, b) => {
        const byTime = (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
        if (byTime) return byTime;
        const byDay = String(b.studyDay).localeCompare(String(a.studyDay));
        return byDay || b._index - a._index;
      });

      // THE DAY IS THE PARTITION; the book is only the grouping INSIDE it.
      //
      // This used to dedupe by book across the WHOLE seven-day window, which
      // quietly destroyed the history it was meant to show: a story read on
      // Monday, Wednesday and again today collapsed into ONE card wearing
      // today's date, and Monday and Wednesday vanished from the shelf
      // entirely. The count said `x3` and the shelf said "today", so the two
      // facts on the card contradicted each other.
      //
      // Repeats still collapse — a four-year-old reads the same story six times
      // and six identical covers is not a shelf — but only WITHIN one day,
      // where "you read this three times today" is a true sentence.
      //
      // Keyed by contentId, falling back to a normalized title: a row with no
      // contentId still must not duplicate one that has the same name, and two
      // genuinely untitled rows are left alone rather than collapsed into one.
      const byDay = new Map();
      for (const row of ordered) {
        const key = row?.contentId
          ? `id:${row.contentId}`
          : (row?.title ? `title:${String(row.title).trim().toLowerCase()}` : null);
        if (!key) continue;
        if (!byDay.has(row.studyDay)) byDay.set(row.studyDay, new Map());
        const books = byDay.get(row.studyDay);
        const seen = books.get(key);
        if (seen) {
          seen.times += 1;
          // Every clock time that day, newest first — the card can badge the
          // count and the celebration screen can print the times themselves.
          if (row?.at) seen.at.push(row.at);
          continue;
        }
        books.set(key, {
          title: row?.title ?? null, contentId: row?.contentId ?? null,
          pickId: row?.pickId ?? null, at: row?.at ? [row.at] : [], times: 1,
        });
      }
      // `ordered` is already newest-first, so both the day order and the book
      // order within a day fall out of insertion order.
      recentDays = [...byDay.entries()]
        .slice(0, RECENT_DAY_GROUPS)
        .map(([day, books]) => ({ studyDay: day, books: [...books.values()].slice(0, BOOKS_PER_DAY) }))
        .filter((group) => group.books.length > 0);

      // THE STREAK WALL. One square per day, oldest first, so the grid fills
      // left-to-right and today lands in the last cell. Two channels, one job:
      // the NUMBER is how many books, the STATE is whether the day's obligation
      // was met. A child reads the colour from the sofa and the number up close.
      //
      // KNOWN LIMITATION, deliberately not hidden: the target is read from the
      // CURRENT enrollment, because no historical target is stored anywhere. A
      // household that changes the daily target re-colours its own past. Every
      // day is judged against `target` as it stands today, and a day we cannot
      // judge says so rather than guessing.
      const target = Number.isFinite(status?.target) ? status.target : null;
      const schedule = status?.schedule ?? null;
      streak = days.map((day, index) => {
        const books = (batches[index] ?? []).length;
        // A DAY NOBODY ASKED ABOUT IS NOT A DAY THEY MISSED. Weekends and
        // holidays used to draw the same grey as a school day with no reading,
        // which made a normal week look like a broken streak. `rest` is drawn
        // near-transparent instead: a miss stays visible, a rest recedes.
        //
        // Reading on a rest day still counts — the agenda never un-serves work
        // done on a non-school day — so `met` is checked FIRST and a Saturday
        // story is a green square.
        // A NAMED DAY OFF IS NOT A WEEKEND, and the wall must not draw them
        // alike. `rest` recedes on purpose — a Saturday is the ordinary rhythm
        // and greying it made a normal week look like a broken streak. But
        // Thanksgiving is a thing that HAPPENED, and a child looking for why
        // the middle of that week is blank deserves to be told rather than
        // shown the same near-invisible square a Saturday gets.
        //
        // The name comes from the HOUSEHOLD calendar, not the enrollment's own
        // schedule: a course may excuse a day for its own reasons, but only the
        // house declares Christmas. Reading still counts on a holiday — `met`
        // and `partial` are checked first, exactly as they are for a rest day,
        // because the agenda never un-serves work done on a day off.
        const asked = isSchoolDay(day, schedule);
        const holiday = namedDayOff(day, this.#householdCalendar);
        let state;
        if (target === null) state = books > 0 ? 'unknown-met' : 'unknown';
        else if (target > 0 && books >= target) state = 'met';
        else if (books > 0) state = 'partial';
        else if (holiday) state = 'holiday';
        else state = asked ? 'none' : 'rest';
        return { studyDay: day, books, target, asked, state,
          ...(holiday ? { holiday: holiday.label } : {}) };
      }).reverse();
    }
    let displayName = null;
    try { displayName = trimmed(this.#resolveLearner?.(learnerId)?.name); } catch { displayName = null; }
    return { learnerId, displayName, enrolled: status?.enrolled ?? null, error: status ? status.error === true : true,
      count: status?.count ?? null, target: status?.target ?? null, progressLabel: status?.progressLabel ?? null,
      // What the reading counts toward, for the surfaces that acknowledge
      // credit (the living-room surround rail). `null` when the household
      // authored no subject on the story-time enrollment — never guessed.
      subject: status?.subject ?? null,
      doneToday: status?.doneToday ?? null, studyDay, yesterday,
      // Day groups, newest first — NOT a flat list. See the partition above.
      recentDays,
      // One entry per day, OLDEST first, so a 7-wide grid reads like a calendar.
      streak };
  }
}
