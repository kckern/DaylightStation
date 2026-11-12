import { YamlUserAppRecordStore } from "#system/persistence/YamlUserAppRecordStore.mjs";
import { creditDecision, policyFor, GOOD_FAITH_DEFAULTS } from "../../portable/practice/goodFaith.mjs";

const SITTING_FIELDS = ['practiceNotes', 'humanNotes', 'playedSec', 'checkIns', 'scaleCheckIns', 'drillsPassed'];
const intOf = (v) => Math.max(0, Math.floor(Number(v) || 0));

/**
 * UserVideoProgressStore — per-user video course progress for the piano kiosk.
 *
 * Single source of truth for the completion rule: a lecture is complete when
 * the user has watched >= threshold percent AND engaged (played along) at least
 * once. `engaged` is a sticky boolean on the stored entry — once true it stays
 * true for the session's lifetime of that entry. completedAt is stamped once
 * and never cleared (a later rewatch from the start can't revert completion).
 *
 * Storage: data/users/{userId}/apps/{app}/{filename}.yml, keyed by plex:{id}.
 * `app`/`filename` default to 'piano'/'video-progress' so Piano's behaviour is
 * unchanged. School consumers construct with { app: 'school', filename:
 * 'material-progress' }. Installed composition deliberately supplies the same
 * Piano policy to that legacy School store, preserving its stored completion
 * fields and logging. School computes its own material completion separately.
 */
export class YamlUserVideoProgressStore {
  #configService;
  #logger;
  #records;
  #expectations;
  #sittingLog;
  #judgements;

  constructor({ configService, logger = console, app = 'piano', filename = 'video-progress', lessonExpectations = null, sittingLog = null, legitJudgements = null }) {
    this.#configService = configService;
    this.#logger = logger;
    this.#records = new YamlUserAppRecordStore({ configService, app, filename });
    this.#expectations = lessonExpectations;
    this.#sittingLog = sittingLog;
    this.#judgements = legitJudgements;
  }

  #videosConfig() {
    return this.#configService.getHouseholdAppConfig?.(null, 'piano')?.videos || {};
  }

  #expectationFor(plexId) {
    if (!this.#expectations) return null;
    try { return this.#expectations.get(plexId) ?? null; } catch (err) {
      this.#logger.warn?.('piano.lesson-expectation.read-failed', { plexId, error: err.message });
      return null;
    }
  }

  /** The course key a lesson is judged under: its season when that is listed as preschool, else its show. */
  #courseKeyFor(expectation, preschoolCourses) {
    const listed = new Set((preschoolCourses || []).map((c) => String(c).replace(/^plex:/, '')));
    const season = expectation.seasonKey != null ? String(expectation.seasonKey).replace(/^plex:/, '') : null;
    return season && listed.has(season) ? season : expectation.showKey;
  }

  /** What the kiosk needs to score a lesson live: its target and whether it is preschool. */
  #kioskExpectation(item) {
    const e = this.#expectationFor(item.plex || item.id);
    if (!e) return null;
    const pcfg = this.#videosConfig().practice || {};
    const pre = Array.isArray(pcfg.preschool_courses) ? pcfg.preschool_courses : [];
    const key = this.#courseKeyFor(e, pre);
    const preschool = pre.map((c) => String(c).replace(/^plex:/, '')).includes(String(key ?? '').replace(/^plex:/, ''));
    return { targetNpm: e.targetNpm, source: e.source, preschool };
  }

  /** Merge one sitting's report into the entry's banked practice (field-wise max per sitting, newest 12). */
  #mergePractice(existing, practice, cap) {
    const prev = existing && typeof existing === 'object' ? existing : {};
    const sittings = { ...(prev.sittings || {}) };
    if (practice && practice.sittingId) {
      const id = String(practice.sittingId).slice(0, 64);
      const old = sittings[id] || {};
      const next = { at: new Date().toISOString() };
      for (const f of SITTING_FIELDS) next[f] = Math.max(intOf(old[f]), intOf(practice[f]));
      sittings[id] = next;
    }
    const kept = Object.entries(sittings).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, cap);
    const map = Object.fromEntries(kept);
    const drillsPassed = Math.max(0, ...kept.map(([, v]) => intOf(v.drillsPassed)));
    return { sittings: map, drillsPassed, rotation: intOf(prev.rotation) };
  }

  /** Judge credit for an entry at this post. */
  #decide({ userId, existing, percent, threshold, nowEngaged, practice, plexId, practiceState }) {
    const videos = this.#videosConfig();
    const pcfg = videos.practice || {};
    const expectation = this.#expectationFor(plexId);
    const gateOn = videos.user_policies?.[userId]?.engagement_gate !== false;
    const enforced = expectation && gateOn ? expectation : null;
    const preschoolCourses = Array.isArray(pcfg.preschool_courses) ? pcfg.preschool_courses : [];
    const courseId = enforced ? this.#courseKeyFor(enforced, preschoolCourses) : null;
    const policy = policyFor({ courseId, preschoolCourses, passScore: pcfg.pass_score, preschoolPassScore: pcfg.preschool_pass_score });
    const legacy = !practice && pcfg.legacy_clients !== false;
    const review = practice?.sittingId && this.#judgements
      ? (this.#judgements.get({ userId, sittingId: String(practice.sittingId), kind: 'end-of-lesson' }) ?? null)
      : null;
    const roots = Array.isArray(pcfg.drill_roots) && pcfg.drill_roots.length ? pcfg.drill_roots : undefined;
    const prevOwed = existing.credit?.outcome === 'drill-owed';
    const args = {
      percent, thresholdPercent: threshold, expectation: enforced, sittings: practiceState.sittings,
      drillsPassed: practiceState.drillsPassed, engaged: nowEngaged, legacy, roots,
      rotation: practiceState.rotation, review,
    };
    let decision = creditDecision(args, policy);
    if (decision.outcome === 'drill-owed' && !prevOwed) {
      // A newly offered drill deals the next keys; later posts keep them.
      practiceState.rotation += 1;
      decision = creditDecision({ ...args, rotation: practiceState.rotation }, policy);
    }
    return { decision, expectation: enforced, policy, review };
  }

  #threshold() {
    const cfg = this.#configService.getHouseholdAppConfig?.(null, 'piano') || {};
    return cfg.videos?.completion_threshold_percent ?? 90;
  }

  #keyFor(plexId) {
    const raw = String(plexId).replace(/^plex:/, '');
    return `plex:${raw}`;
  }

  // Done = credited. An entry judged by the good-faith score is done only via
  // completedAt; older entries (no credit record) keep the percent+engaged rule.
  #isDone(up, threshold) {
    if (up?.completedAt) return true;
    if (up?.credit) return false;
    return (up?.percent ?? 0) >= threshold && this.#wasEngaged(up);
  }

  // Legacy tolerance: older entries used engagementCount instead of a boolean.
  #wasEngaged(entry) {
    return !!entry?.engaged || (entry?.engagementCount ?? 0) > 0;
  }

  /**
   * Record a progress update. Returns the updated entry, or null for unknown user.
   * @param {{userId:string, plexId:string, percent:number, seconds?:number, duration?:number, engaged?:boolean}}
   */
  record({ userId, plexId, percent, seconds, duration, engaged, practice = null, title = null }) {
    const records = this.#records.forUser(userId);
    if (!records) return null;

    const key = this.#keyFor(plexId);
    const threshold = this.#threshold();
    const progress = records.read() || {};
    const existing = progress[key] || {};

    const wasCompleted = !!existing.completedAt;
    const nowEngaged = this.#wasEngaged(existing) || !!engaged;
    const normalizedPercent = Math.round(parseFloat(percent) || 0);
    // Only the piano store judges practice; a store built without an
    // expectation source (School's material progress) keeps today's rule.
    const report = this.#expectations && practice && typeof practice === 'object' ? practice : null;
    const practiceState = this.#mergePractice(existing.practice, report, GOOD_FAITH_DEFAULTS.maxSittings);

    let completedAt = existing.completedAt || null;
    let credit = existing.credit ?? null;
    let judged = null;
    if (!wasCompleted && !this.#expectations) {
      if (normalizedPercent >= threshold && nowEngaged) completedAt = new Date().toISOString();
    } else if (!wasCompleted) {
      // Judge on the furthest the lesson was ever watched: a rewatch from the
      // start lowers `percent`, and must never undo a warm-up already owed.
      const furthest = Math.max(normalizedPercent, Number(existing.furthestPercent) || 0, existing.credit ? threshold : 0);
      judged = this.#decide({ userId, existing, percent: furthest, threshold, nowEngaged, practice: report, plexId, practiceState });
      const d = judged.decision;
      if (d.outcome !== 'not-watched') {
        credit = {
          outcome: d.outcome,
          score: d.score,
          rawScore: d.rawScore,
          practiceNpm: d.practiceNpm,
          targetNpm: d.targetNpm,
          source: judged.expectation?.source ?? null,
          drill: d.drill ? { reps: d.drill.reps, sets: d.drill.sets, roots: d.drill.roots, spec: d.drill.spec } : null,
          reviewed: !!d.reviewed,
          reviewProbability: d.reviewed ? Number(judged.review?.probability) : null,
          preschool: !!judged.policy?.preschool,
          decidedAt: new Date().toISOString(),
        };
        if (d.credited) completedAt = new Date().toISOString();
        this.#logger.info?.('piano.lesson-credit.decision', {
          userId, key, percent: normalizedPercent, score: d.score, rawScore: d.rawScore, reviewed: !!d.reviewed,
          reviewProbability: credit.reviewProbability, practiceNpm: d.practiceNpm, targetNpm: d.targetNpm,
          source: credit.source, outcome: d.outcome, drillReps: d.drill?.reps ?? 0, drillsPassed: practiceState.drillsPassed,
          preschool: credit.preschool,
        });
        if (d.outcome === 'legacy') {
          this.#logger.sampled?.('piano.lesson-credit.legacy-client', { userId, key }, { maxPerMinute: 2, aggregate: true });
        }
      }
    }

    const entry = {
      ...existing,
      playhead: Math.round(parseFloat(seconds) || 0),
      percent: normalizedPercent,
      duration: Math.round(parseFloat(duration) || 0),
      lastPlayed: new Date().toISOString(),
      engaged: nowEngaged,
      completedAt,
    };
    if (this.#expectations) entry.furthestPercent = Math.max(normalizedPercent, Number(existing.furthestPercent) || 0);
    if (report || existing.practice) entry.practice = practiceState;
    if (credit) entry.credit = credit;
    // Drop any legacy counter field so entries converge on the boolean.
    delete entry.engagementCount;

    progress[key] = entry;
    records.write(progress);
    this.#logger.info?.('piano.video-progress.record', {
      userId, key, percent: normalizedPercent, engaged: nowEngaged, completed: !!completedAt,
      ...(credit ? { outcome: credit.outcome, score: credit.score ?? null } : {}),
    });
    if (report?.sittingId && this.#sittingLog) {
      try {
        const sit = practiceState.sittings[String(report.sittingId).slice(0, 64)] || {};
        this.#sittingLog.upsert(userId, {
          sittingId: String(report.sittingId).slice(0, 64),
          plexId: key,
          title: typeof title === 'string' ? title.slice(0, 200) : (existing.title ?? null),
          percent: normalizedPercent,
          durationSec: entry.duration,
          playedSec: sit.playedSec ?? 0,
          humanNotes: sit.humanNotes ?? 0,
          practiceNotes: sit.practiceNotes ?? 0,
          targetNpm: credit?.targetNpm ?? null,
          expectationSource: credit?.source ?? null,
          score: credit?.score ?? null,
          rawScore: credit?.rawScore ?? null,
          reviewed: !!credit?.reviewed,
          reviewProbability: credit?.reviewProbability ?? null,
          outcome: wasCompleted ? 'already-counted' : (credit?.outcome ?? 'watching'),
          drillReps: credit?.drill?.reps ?? 0,
          drillsPassed: practiceState.drillsPassed,
          checkIns: sit.checkIns ?? 0,
          scaleCheckIns: sit.scaleCheckIns ?? 0,
          legitChecks: intOf(report.legitChecks),
          preschool: !!credit?.preschool,
        });
      } catch (err) {
        this.#logger.warn?.('piano.lesson-sittings.write-failed', { userId, key, error: err.message });
      }
    }
    // `newlyCompleted` is a RETURN-VALUE signal only (true iff completedAt went
    // absent→present in THIS call). It is deliberately NOT part of the persisted
    // `entry` above, so it never lands in video-progress.yml. Callers (the play
    // /log route) use it to fire the one-time economy earn on the transition.
    return { ...entry, newlyCompleted: !wasCompleted && !!completedAt };
  }

  /**
   * Enrich playable items with this user's progress fields. Items are matched by
   * their plex/id. Adds userPercent, userPlayhead, userWatched, userEngaged,
   * userCompletedAt, userLastPlayedAt. If the user is unknown, items are
   * returned unchanged.
   */
  enrich(items, userId) {
    if (!Array.isArray(items)) return items;
    const records = this.#records.forUser(userId);
    if (!records) return items;

    const progress = records.read() || {};
    const threshold = this.#threshold();
    const expectations = new Map();
    if (this.#expectations) {
      for (const item of items) {
        const e = item && this.#kioskExpectation(item);
        if (e) expectations.set(item, e);
      }
    }

    return items.map((item) => {
      const key = this.#keyFor(item.plex || item.id);
      const up = progress[key] || {};
      const engaged = this.#wasEngaged(up);
      const userWatched = this.#isDone(up, threshold);
      return {
        ...item,
        userPercent: up.percent ?? null,
        userPlayhead: up.playhead ?? null,
        userWatched,
        userEngaged: engaged,
        userCompletedAt: up.completedAt || null,
        userLastPlayedAt: up.lastPlayed || null,
        userCredit: up.credit ? { outcome: up.credit.outcome, drill: up.credit.drill ?? null, preschool: !!up.credit.preschool } : null,
        ...(expectations.has(item) ? { expectation: expectations.get(item) } : {}),
      };
    });
  }

  /**
   * Aggregate one user's progress across a course's lecture `items`. Returns
   * `{ completed, total, lastPlayedAt }` using the same completion rule as
   * enrich (completedAt, or >= threshold AND engaged). `total` is items.length;
   * the caller excludes reference units before calling. Unknown user → zeros.
   */
  summarize(items, userId) {
    const total = Array.isArray(items) ? items.length : 0;
    const records = this.#records.forUser(userId);
    if (!records || total === 0) return { completed: 0, total, lastPlayedAt: null };

    const progress = records.read() || {};
    const threshold = this.#threshold();
    let completed = 0;
    let lastPlayedAt = null;

    for (const item of items) {
      const up = progress[this.#keyFor(item.plex || item.id)];
      if (!up) continue;
      const done = this.#isDone(up, threshold);
      if (done) completed += 1;
      if (up.lastPlayed && (!lastPlayedAt || up.lastPlayed > lastPlayedAt)) lastPlayedAt = up.lastPlayed;
    }
    return { completed, total, lastPlayedAt };
  }

  /** mtimeMs of the user's progress file — cache key material. 0 when absent. */
  progressFileMtime(userId) {
    const records = this.#records.forUser(userId);
    if (!records) return 0;
    return records.mtime();
  }

  // Convenience guard reused by routers.
  isKnownUser(userId) {
    return !!this.#records.forUser(userId);
  }
}

export default YamlUserVideoProgressStore;
