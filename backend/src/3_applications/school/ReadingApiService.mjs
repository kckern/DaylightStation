const YESTERDAY_LIMIT = 4;
const RECENT_LIMIT = 6;
const RECENT_DAYS = 7;
const trimmed = value => typeof value === 'string' && value.trim() ? value.trim() : null;

function dayBefore(studyDay) {
  const midnight = Date.parse(`${studyDay}T00:00:00.000Z`);
  if (!Number.isFinite(midnight)) return null;
  return new Date(midnight - 86_400_000).toISOString().slice(0, 10);
}

export class ReadingApiService {
  #recordStoryRead; #sessions; #storyTime; #readingLog; #resolveLearner; #logger; #observations; #clock; #nowMs;
  constructor({ recordStoryRead, sessions, storyTime = null, readingLog = null, resolveLearner = null,
    logger = console, observationStore = null, clock = () => new Date(), nowMs = Date.now } = {}) {
    if (!recordStoryRead) throw new Error('createReadingRouter requires recordStoryRead');
    if (!sessions) throw new Error('createReadingRouter requires a sessions store');
    this.#recordStoryRead = recordStoryRead; this.#sessions = sessions; this.#storyTime = storyTime;
    this.#readingLog = readingLog; this.#resolveLearner = resolveLearner; this.#logger = logger;
    this.#observations = observationStore; this.#clock = clock; this.#nowMs = nowMs;
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
    let recent = [];
    const studyDay = (() => { try { return this.#storyTime?.studyDay?.() ?? null; } catch { return null; } })();
    if (studyDay && this.#readingLog?.listForDay) {
      const days = [studyDay];
      while (days.length < RECENT_DAYS) {
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
      recent = batches.flat()
        .sort((a, b) => {
          const byTime = (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
          if (byTime) return byTime;
          const byDay = String(b.studyDay).localeCompare(String(a.studyDay));
          return byDay || b._index - a._index;
        })
        .slice(0, RECENT_LIMIT)
        .map(row => ({
          title: row?.title ?? null, contentId: row?.contentId ?? null,
          pickId: row?.pickId ?? null, at: row?.at ?? null, studyDay: row.studyDay,
        }));
    }
    let displayName = null;
    try { displayName = trimmed(this.#resolveLearner?.(learnerId)?.name); } catch { displayName = null; }
    return { learnerId, displayName, enrolled: status?.enrolled ?? null, error: status ? status.error === true : true,
      count: status?.count ?? null, target: status?.target ?? null, progressLabel: status?.progressLabel ?? null,
      doneToday: status?.doneToday ?? null, studyDay, yesterday, recent };
  }
}
