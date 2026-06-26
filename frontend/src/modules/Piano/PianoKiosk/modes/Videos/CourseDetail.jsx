// CourseDetail.jsx
import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { lectureStatus } from './lectureMeta.js';
import { groupUnits } from './courseUnits.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/** One lecture card (thumbnail + watch badge + caption). */
function LectureCard({ item, onPlay }) {
  const st = lectureStatus(item);
  const img = item.image || item.thumbnail;
  return (
    <li>
      <button type="button" className="piano-episode" onClick={() => onPlay(item)}>
        <div className="piano-episode__thumb">
          {img && <img src={img} alt="" loading="eager" decoding="async" />}
          {st.watched && <span className="piano-episode__check" aria-label="Watched">✓</span>}
          {!st.watched && st.percent > 0 && (
            <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>
          )}
        </div>
        <div className="piano-episode__label">
          {item.itemIndex != null && <span className="piano-episode__num">E{item.itemIndex}</span>}
          <span className="piano-episode__title">{item.label || item.title}</span>
        </div>
      </button>
    </li>
  );
}

/**
 * Course landing page — FitnessShow-style two-panel layout: a left info panel
 * (poster + title + summary + count) and a right scrollable grid of lecture
 * cards. Watch state (✓ / progress bar) rides on the thumbnail and comes from
 * media_memory signals (see lectureStatus). Tap a card to play.
 *
 * Multi-season courses (e.g. Hoffman Academy's 18 "units") render a tappable
 * unit-tab strip above the grid. On landing the right grid pre-loads Unit 1's
 * lectures while the LEFT panel keeps showing the *show* poster/summary — it
 * only switches to a season's own poster/summary once the user explicitly taps
 * a unit tab. Season summaries are fetched lazily on first tap. Single-season
 * courses render a flat list with no tabs.
 */
export default function CourseDetail({ course, onPlay }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const courseId = idOf(course?.id);
        logger.info('piano.course-load', { courseId });
        const res = await DaylightAPI(`api/v1/fitness/show/${courseId}/playable`);
        if (!cancelled) setData(res || { items: [] });
      } catch (err) {
        if (!cancelled) { setData({ items: [] }); setError(err.message); }
        logger.warn('piano.course-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, course?.id]);

  const info = data?.info || {};
  const items = data ? (data.items || []) : null;
  const showPoster = info.image || course?.image;
  const showTitle = course?.title || info.title || 'Course';

  // Seasons ("units") when this is a multi-season course; null otherwise.
  const units = useMemo(() => (data ? groupUnits(data) : null), [data]);

  // `activeUnit` drives the right grid (defaults to Unit 1). `tabSelected`
  // gates the LEFT panel: false → show-level info; true → the active season's
  // own poster/summary. Reset whenever a new course loads.
  const [activeUnit, setActiveUnit] = useState(0);
  const [tabSelected, setTabSelected] = useState(false);
  const [seasonSummaries, setSeasonSummaries] = useState({}); // unitId -> summary | null
  useEffect(() => {
    setActiveUnit(0);
    setTabSelected(false);
    setSeasonSummaries({});
    if (units) logger.info('piano.course-units', { unitCount: units.length });
  }, [units, logger]);

  const activeUnitObj = units ? units[activeUnit] : null;
  const visibleItems = units ? (activeUnitObj?.items || []) : items;

  // Left panel shows the season only after an explicit tab press.
  const showSeasonOnLeft = Boolean(units && tabSelected && activeUnitObj);

  // Lazily fetch the selected season's summary the first time it's shown.
  useEffect(() => {
    if (!showSeasonOnLeft) return undefined;
    const id = activeUnitObj.id;
    if (seasonSummaries[id] !== undefined) return undefined; // already fetched
    let cancelled = false;
    DaylightAPI(`api/v1/list/plex/${id}`)
      .then((res) => { if (!cancelled) setSeasonSummaries((s) => ({ ...s, [id]: res?.info?.summary || null })); })
      .catch(() => { if (!cancelled) setSeasonSummaries((s) => ({ ...s, [id]: null })); });
    return () => { cancelled = true; };
  }, [showSeasonOnLeft, activeUnitObj, seasonSummaries]);

  const onTab = (i) => { setActiveUnit(i); setTabSelected(true); };

  // Left-panel content: season (post-tap) vs show (landing / single-season).
  const leftPoster = showSeasonOnLeft ? (activeUnitObj.thumbnail || showPoster) : showPoster;
  const leftTitle = showSeasonOnLeft ? activeUnitObj.title : showTitle;
  const leftSummary = showSeasonOnLeft ? seasonSummaries[activeUnitObj.id] : info.summary;
  const leftCount = showSeasonOnLeft
    ? `${activeUnitObj.items.length} lectures`
    : (units ? `${units.length} units · ${items?.length ?? 0} lectures` : `${items?.length ?? 0} lectures`);

  // Current location in the header breadcrumb (Videos › this course) — always
  // the show, even while a season is shown on the left.
  usePianoBreadcrumb(useMemo(() => [{ label: showTitle }], [showTitle]));

  return (
    <section className="piano-mode--videos piano-course">
      <div className="piano-course__content">
        <aside className="piano-course__info">
          {leftPoster && <img className="piano-course__poster" src={leftPoster} alt="" />}
          <h2 className="piano-course__title">{leftTitle}</h2>
          {items?.length > 0 && <div className="piano-course__count">{leftCount}</div>}
          {leftSummary && <p className="piano-course__summary">{leftSummary}</p>}
        </aside>

        <div className="piano-course__episodes">
          {items === null && <PianoEmpty loading />}
          {items?.length === 0 && <PianoEmpty message={error || 'No lectures found.'} />}
          {items?.length > 0 && (
            <>
              {units && (
                <div className="piano-course__units" role="tablist" aria-label="Units">
                  {units.map((u, i) => {
                    const done = u.items.every((it) => lectureStatus(it).watched);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        role="tab"
                        aria-selected={i === activeUnit}
                        title={u.title}
                        className={`piano-course__unit${i === activeUnit ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                        onClick={() => onTab(i)}
                      >
                        <span className="piano-course__unit-num">{u.index != null ? `Unit ${u.index}` : u.title}</span>
                        {done && <span className="piano-course__unit-check" aria-label="Unit complete">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {activeUnitObj && <h3 className="piano-course__unit-title">{activeUnitObj.title}</h3>}
              <ul className="piano-episodes">
                {visibleItems.map((item) => (
                  <LectureCard key={item.plex || item.id} item={item} onPlay={onPlay} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
