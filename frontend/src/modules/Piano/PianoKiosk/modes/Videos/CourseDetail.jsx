// CourseDetail.jsx
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { lectureUserStatus } from './lectureMeta.js';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';
import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

// Lecture length for the thumb corner badge. `duration` arrives in seconds;
// render M:SS (or H:MM:SS for the rare hour-plus lecture). Null when unknown.
function fmtDuration(sec) {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Best-effort ascending C-E-G chime when a new unit unlocks. Silent if no AudioContext.
function playUnlockChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.start(t); osc.stop(t + 0.6);
    });
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch { /* no audio available */ }
}

// Two-person silhouette — distinguishes the co-progress lock from the standard
// sequential padlock at a glance.
function CoProgressLockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: '1em', height: '1em' }}>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  );
}

/**
 * Course landing page. Per-user watch state (✓ / progress) rides on each
 * thumbnail. Sequential courses lock episodes after the first unwatched LESSON one
 * and, when multi-unit, hide lesson units beyond the first incomplete one. Lesson
 * units render newest-on-top (descending), episodes ascending within. Config-flagged
 * "reference" units (exercise/practice/walkthrough banks) are never locked, give no
 * credit, and render in an always-open "Practice & Reference" section at the bottom.
 */
export default function CourseDetail({ course, onPlay }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const { currentUser, currentProfile, users } = usePianoUser();
  const courseId = idOf(course?.id);
  const { items, info, parents, isSequential, loading, error, coProgressLock, referenceUnitIds } = usePianoCoursePlayable(courseId, currentUser);

  const seasons = useMemo(() => {
    if (!parents || typeof parents !== 'object') return [];
    return Object.entries(parents)
      .map(([id, p]) => ({
        id: String(id),
        index: Number.isFinite(p?.index) ? p.index : (parseInt(p?.index, 10) || 0),
        title: p?.title || null,
        thumbnail: p?.thumbnail || null,
      }))
      .sort((a, b) => a.index - b.index);
  }, [parents]);

  // Reference units (config-flagged): split out from the gated lesson flow.
  const referenceUnitIdSet = useMemo(() => new Set(referenceUnitIds || []), [referenceUnitIds]);
  const lessonSeasons = useMemo(
    () => seasons.filter((s) => !referenceUnitIdSet.has(s.id)),
    [seasons, referenceUnitIdSet],
  );
  const referenceSeasons = useMemo(
    () => seasons.filter((s) => referenceUnitIdSet.has(s.id)),
    [seasons, referenceUnitIdSet],
  );

  const episodesOf = useCallback(
    (seasonId) => (items || []).filter((ep) => String(ep.parentId) === String(seasonId)),
    [items],
  );

  const seasonComplete = useCallback(
    (seasonId) => {
      const eps = episodesOf(seasonId);
      return eps.length > 0 && eps.every((ep) => lectureUserStatus(ep).watched);
    },
    [episodesOf],
  );

  // Lesson episodes only — all sequencing math (lock/current/reveal) ignores reference.
  const lessonItems = useMemo(
    () => (items || []).filter((ep) => !referenceUnitIdSet.has(String(ep.parentId))),
    [items, referenceUnitIdSet],
  );

  // Visible lesson units: sequential multi-unit shows through the FIRST incomplete
  // unit then stops (hiding later ones); otherwise all lesson units are visible.
  const visibleSeasons = useMemo(() => {
    if (!isSequential || lessonSeasons.length <= 1) return lessonSeasons;
    const out = [];
    for (const s of lessonSeasons) {
      out.push(s);
      if (!seasonComplete(s.id)) break;
    }
    return out;
  }, [isSequential, lessonSeasons, seasonComplete]);

  // Linear locked set for sequential courses: every LESSON episode after the first
  // not-yet-watched lesson episode (ordered by unit index, then itemIndex).
  const lockedIds = useMemo(() => {
    if (!isSequential || !lessonItems.length) return new Set();
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...lessonItems].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const locked = new Set();
    let gateClosed = false;
    for (const ep of sorted) {
      if (gateClosed) locked.add(ep.plex || ep.id);
      if (!gateClosed && !lectureUserStatus(ep).watched) gateClosed = true;
    }
    return locked;
  }, [isSequential, lessonItems, seasons]);

  // The "current" lesson: the first not-yet-watched LESSON episode (linear order) —
  // the one the gate sits at and the student should play next. Goldenrod. Null for
  // non-sequential courses.
  const currentId = useMemo(() => {
    if (!isSequential || !lessonItems.length) return null;
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...lessonItems].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const next = sorted.find((ep) => !lectureUserStatus(ep).watched);
    return next ? (next.plex || next.id) : null;
  }, [isSequential, lessonItems, seasons]);

  // Co-progress lock: if the backend says the user is too far ahead, the first
  // available (unwatched) LESSON episode gets a navigation gate instead of playing.
  const coProgressLockedId = useMemo(() => {
    if (!coProgressLock?.locked || !isSequential || !lessonItems.length) return null;
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...lessonItems].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const next = sorted.find((ep) => !lectureUserStatus(ep).watched);
    return next ? (next.plex || next.id) : null;
  }, [coProgressLock, isSequential, lessonItems, seasons]);

  // Unlock ceremony: when the complete lesson-unit set grows, toast + chime the newly
  // revealed next lesson unit. Skips the first render (no "prev" to compare against).
  const [unlockedToast, setUnlockedToast] = useState(null);
  const [coProgressToast, setCoProgressToast] = useState(null);
  const prevCompleteRef = useRef(null);
  useEffect(() => {
    if (!isSequential || lessonSeasons.length <= 1 || !items) return;
    const completeNow = new Set(lessonSeasons.filter((s) => seasonComplete(s.id)).map((s) => s.id));
    const prev = prevCompleteRef.current;
    if (prev) {
      for (let i = 0; i < lessonSeasons.length; i += 1) {
        const s = lessonSeasons[i];
        if (completeNow.has(s.id) && !prev.has(s.id)) {
          const next = lessonSeasons[i + 1];
          if (next) {
            const name = next.title || `Unit ${next.index}`;
            setUnlockedToast(name);
            playUnlockChime();
            logger.info('piano.season-unlocked', { season: next.id, name });
            setTimeout(() => setUnlockedToast(null), 4000);
          }
        }
      }
    }
    prevCompleteRef.current = completeNow;
  }, [isSequential, lessonSeasons, items, seasonComplete, logger]);

  const poster = info?.image || course?.image;
  const title = course?.title || info?.title || 'Course';
  usePianoBreadcrumb(useMemo(() => [{ label: title }], [title]));

  const renderEpisode = (item, opts = {}) => {
    const reference = !!opts.reference;
    const st = lectureUserStatus(item);
    const img = item.image || item.thumbnail;
    const key = item.plex || item.id;
    const isSequentiallyLocked = !reference && lockedIds.has(key);
    const isCoProgressLocked = !reference && key === coProgressLockedId;
    const isLocked = isSequentiallyLocked || isCoProgressLocked;
    // Not "current" if co-progress locked or a reference episode.
    const isCurrent = !reference && key === currentId && !isCoProgressLocked;
    const duration = fmtDuration(item.duration);

    const handleClick = () => {
      if (isSequentiallyLocked) return;
      if (isCoProgressLocked) {
        const name = (users || []).find((u) => u.id === coProgressLock.waitingForId)?.name
          || coProgressLock.waitingForId;
        setCoProgressToast(
          `You're ${coProgressLock.aheadBy} episodes ahead of ${name} — let them catch up first.`,
        );
        setTimeout(() => setCoProgressToast(null), 4000);
        return;
      }
      onPlay(item);
    };

    return (
      <li key={key}>
        <button
          type="button"
          className={[
            'piano-episode',
            isLocked && 'piano-episode--locked',
            isCurrent && 'piano-episode--current',
          ].filter(Boolean).join(' ')}
          onClick={handleClick}
          disabled={isSequentiallyLocked}
          aria-disabled={isLocked}
          aria-current={isCurrent ? 'true' : undefined}
        >
          <div className="piano-episode__thumb">
            {img && <img src={img} alt="" loading="eager" decoding="async" />}
            {isSequentiallyLocked && (
              <span className="piano-episode__lock" aria-label="Locked"><LockIcon /></span>
            )}
            {isCoProgressLocked && (
              <span className="piano-episode__lock piano-episode__lock--co-progress" aria-label="Waiting for partner">
                <CoProgressLockIcon />
              </span>
            )}
            {!isLocked && st.watched && <span className="piano-episode__check" aria-label="Watched">✓</span>}
            {!isLocked && !reference && !st.watched && st.percent > 0 && (
              <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>
            )}
            {duration && <span className="piano-episode__duration">{duration}</span>}
          </div>
          <div className="piano-episode__label">
            {item.itemIndex != null && <span className="piano-episode__num">E{item.itemIndex}</span>}
            <span className="piano-episode__title">{item.label || item.title}</span>
          </div>
        </button>
      </li>
    );
  };

  // Lesson zone is "multi-unit" when there's more than one lesson unit.
  const isMultiSeason = lessonSeasons.length > 1;

  return (
    <section className="piano-mode--videos piano-course">
      <div className="piano-course__content">
        <aside className="piano-course__info">
          {poster && <img className="piano-course__poster" src={poster} alt="" />}
          <h2 className="piano-course__title">{title}</h2>
          {items?.length > 0 && <div className="piano-course__count">{items.length} lectures</div>}
          {isSequential && (
            <div className="piano-course__learner">
              <span className="piano-course__badge">Sequential</span>
              {currentProfile?.name && (
                <span className="piano-course__learner-name">Learning as {currentProfile.name}</span>
              )}
            </div>
          )}
          {info?.summary && <p className="piano-course__summary">{info.summary}</p>}
        </aside>

        <div className="piano-course__episodes">
          {loading && <PianoEmpty loading />}
          {!loading && (!items || items.length === 0) && <PianoEmpty message={error || 'No lectures found.'} />}
          {!loading && items?.length > 0 && (
            <>
              {isMultiSeason ? (
                [...visibleSeasons].reverse().map((s) => {
                  const eps = [...episodesOf(s.id)].sort((a, b) => (a.itemIndex ?? 0) - (b.itemIndex ?? 0));
                  if (!eps.length) return null;
                  return (
                    <div className="piano-course__season" key={s.id}>
                      <h3 className="piano-course__season-title">{s.title || `Unit ${s.index}`}</h3>
                      <ul className="piano-episodes">{eps.map((ep) => renderEpisode(ep))}</ul>
                    </div>
                  );
                })
              ) : (
                <ul className="piano-episodes">{lessonItems.map((ep) => renderEpisode(ep))}</ul>
              )}

              {referenceSeasons.length > 0 && (
                <div className="piano-course__reference">
                  <h3 className="piano-course__reference-title">Practice &amp; Reference · open anytime</h3>
                  {referenceSeasons.map((s) => {
                    const eps = [...episodesOf(s.id)].sort((a, b) => (a.itemIndex ?? 0) - (b.itemIndex ?? 0));
                    if (!eps.length) return null;
                    return (
                      <div className="piano-course__season piano-course__season--reference" key={s.id}>
                        <h4 className="piano-course__season-title">{s.title || `Unit ${s.index}`}</h4>
                        <ul className="piano-episodes">{eps.map((ep) => renderEpisode(ep, { reference: true }))}</ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {unlockedToast && (
        <div className="piano-course__unlock-toast" role="status">🎉 {unlockedToast} unlocked!</div>
      )}
      {coProgressToast && (
        <div className="piano-course__unlock-toast piano-course__co-progress-toast" role="status">
          {coProgressToast}
        </div>
      )}
    </section>
  );
}
