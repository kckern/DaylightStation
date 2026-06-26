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

/**
 * Course landing page. Per-user watch state (✓ / progress) rides on each
 * thumbnail. Sequential courses lock episodes after the first unwatched one and,
 * when multi-season, hide seasons beyond the first incomplete one — revealing the
 * next with a toast + chime as the student completes a unit.
 */
export default function CourseDetail({ course, onPlay }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const { currentUser, currentProfile } = usePianoUser();
  const courseId = idOf(course?.id);
  const { items, info, parents, isSequential, loading, error } = usePianoCoursePlayable(courseId, currentUser);

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

  // Visible seasons: sequential multi-season shows through the FIRST incomplete
  // season then stops (hiding later ones); otherwise all seasons are visible.
  const visibleSeasons = useMemo(() => {
    if (!isSequential || seasons.length <= 1) return seasons;
    const out = [];
    for (const s of seasons) {
      out.push(s);
      if (!seasonComplete(s.id)) break;
    }
    return out;
  }, [isSequential, seasons, seasonComplete]);

  // Linear locked set for sequential courses: everything after the first
  // not-yet-watched episode (ordered by season index, then itemIndex).
  const lockedIds = useMemo(() => {
    if (!isSequential || !items) return new Set();
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...items].sort((a, b) => {
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
  }, [isSequential, items, seasons]);

  // The "current" lesson: in a sequential course, the first not-yet-watched
  // episode (linear order) — i.e. the one the gate sits at and the student should
  // play next. It's the only unwatched episode that is NOT locked. Highlighted in
  // goldenrod. Null for non-sequential courses.
  const currentId = useMemo(() => {
    if (!isSequential || !items) return null;
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...items].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const next = sorted.find((ep) => !lectureUserStatus(ep).watched);
    return next ? (next.plex || next.id) : null;
  }, [isSequential, items, seasons]);

  // Unlock ceremony: when the complete-season set grows, toast + chime the newly
  // revealed next season. Skips the first render (no "prev" to compare against).
  const [unlockedToast, setUnlockedToast] = useState(null);
  const prevCompleteRef = useRef(null);
  useEffect(() => {
    if (!isSequential || seasons.length <= 1 || !items) return;
    const completeNow = new Set(seasons.filter((s) => seasonComplete(s.id)).map((s) => s.id));
    const prev = prevCompleteRef.current;
    if (prev) {
      for (let i = 0; i < seasons.length; i += 1) {
        const s = seasons[i];
        if (completeNow.has(s.id) && !prev.has(s.id)) {
          const next = seasons[i + 1];
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
  }, [isSequential, seasons, items, seasonComplete, logger]);

  const poster = info?.image || course?.image;
  const title = course?.title || info?.title || 'Course';
  usePianoBreadcrumb(useMemo(() => [{ label: title }], [title]));

  const renderEpisode = (item) => {
    const st = lectureUserStatus(item);
    const img = item.image || item.thumbnail;
    const key = item.plex || item.id;
    const isLocked = lockedIds.has(key);
    const isCurrent = key === currentId;
    const duration = fmtDuration(item.duration);
    return (
      <li key={key}>
        <button
          type="button"
          className={`piano-episode${isLocked ? ' piano-episode--locked' : ''}${isCurrent ? ' piano-episode--current' : ''}`}
          onClick={() => { if (!isLocked) onPlay(item); }}
          disabled={isLocked}
          aria-disabled={isLocked}
          aria-current={isCurrent ? 'true' : undefined}
        >
          <div className="piano-episode__thumb">
            {img && <img src={img} alt="" loading="eager" decoding="async" />}
            {isLocked && <span className="piano-episode__lock" aria-label="Locked"><LockIcon /></span>}
            {!isLocked && st.watched && <span className="piano-episode__check" aria-label="Watched">✓</span>}
            {!isLocked && !st.watched && st.percent > 0 && (
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

  const isMultiSeason = seasons.length > 1;

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
            isMultiSeason ? (
              visibleSeasons.map((s) => {
                const eps = [...episodesOf(s.id)].sort((a, b) => (a.itemIndex ?? 0) - (b.itemIndex ?? 0));
                if (!eps.length) return null;
                return (
                  <div className="piano-course__season" key={s.id}>
                    <h3 className="piano-course__season-title">{s.title || `Unit ${s.index}`}</h3>
                    <ul className="piano-episodes">{eps.map(renderEpisode)}</ul>
                  </div>
                );
              })
            ) : (
              <ul className="piano-episodes">{items.map(renderEpisode)}</ul>
            )
          )}
        </div>
      </div>
      {unlockedToast && (
        <div className="piano-course__unlock-toast" role="status">🎉 {unlockedToast} unlocked!</div>
      )}
    </section>
  );
}
