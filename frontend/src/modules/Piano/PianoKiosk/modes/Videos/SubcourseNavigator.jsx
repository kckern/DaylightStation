import { useMemo, useState } from 'react';
import { partitionSeasons, programStats, seasonStats, continueTarget, courseStats, laneOf, groupCourses, partsOf } from './subcourses.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import PianoContextRail from './PianoContextRail.jsx';
import SeasonList from './SeasonList.jsx';
import CourseCards from './CourseCards.jsx';
import LessonList from './LessonList.jsx';
import RepertoireBrowser from './RepertoireBrowser.jsx';

const LANES = [
  { key: 'practice', title: 'Practice' },
  { key: 'lessons', title: 'Lessons' },
  { key: 'repertoire', title: 'Repertoire' },
];

/**
 * Drill-in for a "subcourses" program: Season list → Course cards → Lessons, framed
 * by a persistent context rail (poster, ancestor breadcrumb, progress ring, and a
 * Continue action to the next unwatched lesson). A season with exactly one course
 * collapses straight to its lessons. Navigation is internal state (resets on
 * reload — a kiosk lands back on the season list, consistent with the
 * footer-Back-to-root convention); lesson playback bubbles up via onPlay to the
 * existing player route.
 */
export default function SubcourseNavigator({ course, playable, onPlay }) {
  const { items, parents, info, referenceUnitIds } = playable || {};
  const seasons = useMemo(() => partitionSeasons(items, parents, referenceUnitIds), [items, parents, referenceUnitIds]);
  const [seasonId, setSeasonId] = useState(null);
  const [floor, setFloor] = useState(null);

  const poster = info?.image || course?.image;
  const program = course?.title || info?.title || 'Program';

  const season = useMemo(() => seasons.find((s) => s.id === seasonId) || null, [seasons, seasonId]);
  const activeCourse = useMemo(() => {
    if (!season) return null;
    if (floor != null) return season.courses.find((c) => c.floor === floor) || null;
    if (season.courses.length === 1) return season.courses[0];
    return null;
  }, [season, floor]);
  const collapsed = !!season && season.courses.length === 1;

  const cont = useMemo(() => continueTarget(seasons), [seasons]);

  // Breadcrumb (thin path) still published; rail carries the rich version.
  const crumbs = useMemo(() => {
    const out = [{ label: program, onClick: () => { setSeasonId(null); setFloor(null); } }];
    if (season) out.push({ label: season.title || `Season ${season.index}`, onClick: (activeCourse && !collapsed) ? () => setFloor(null) : undefined });
    if (activeCourse && !collapsed) out.push({ label: activeCourse.label });
    return out;
  }, [program, season, activeCourse, collapsed]);
  usePianoBreadcrumb(crumbs);

  // Rail props per level.
  const ancestors = [];
  if (season) ancestors.push({ label: program, onClick: () => { setSeasonId(null); setFloor(null); } });
  if (activeCourse && !collapsed) ancestors.push({ label: season.title || `Season ${season.index}`, onClick: () => setFloor(null) });
  const railTitle = activeCourse ? activeCourse.label : season ? (season.title || `Season ${season.index}`) : program;
  const ring = (() => {
    if (activeCourse) { const st = courseStats(activeCourse); return activeCourse.reference ? null : { percent: st.percent, label: `${st.watched}/${st.total}`, done: st.complete }; }
    if (season) {
      if (laneOf(season) !== 'lessons') return null;
      const st = seasonStats(season);
      return { percent: st.percent, label: `${st.percent}%`, done: st.totalCourses > 0 && st.completeCourses === st.totalCourses };
    }
    const st = programStats(seasons); return { percent: st.percent, label: `${st.percent}%`, done: st.totalCourses > 0 && st.completeCourses === st.totalCourses };
  })();
  const railContinue = cont ? { kicker: 'Continue', title: cont.lesson.label || cont.lesson.title, sub: seasons.find((s) => s.id === cont.seasonId)?.title || null } : null;

  let pane;
  if (!season) {
    pane = (
      <div className="psc-lanes">
        {LANES.map(({ key, title }) => {
          const bucket = seasons.filter((s) => laneOf(s) === key);
          if (!bucket.length) return null;
          return (
            <section key={key} className="psc-lane">
              <h3 className="psc-lane-title">{title}</h3>
              <SeasonList seasons={bucket} onSelect={(s) => { setSeasonId(s.id); setFloor(null); }} />
            </section>
          );
        })}
      </div>
    );
  } else if (laneOf(season) === 'repertoire') {
    pane = <RepertoireBrowser season={season} onPlay={onPlay} />;
  } else if (activeCourse) {
    pane = <LessonList lessons={activeCourse.lessons} sections={partsOf(activeCourse)} onPlay={onPlay} reference={activeCourse.reference} />;
  } else {
    const grouped = groupCourses(season);
    const cards = (bucket) => (
      <CourseCards season={{ ...season, courses: bucket.courses }}
        currentFloor={cont?.seasonId === season.id ? cont.floor : null}
        onSelect={(c) => setFloor(c.floor)} />
    );
    pane = grouped.length === 1 ? cards(grouped[0]) : (
      <div className="psc-groups">
        {grouped.map((b) => (
          <section key={b.group ?? '_'} className="psc-group">
            <h4 className="psc-group-title">{b.group}</h4>
            {cards(b)}
          </section>
        ))}
      </div>
    );
  }

  return (
    <section className="piano-mode--videos piano-course psc-stage">
      <PianoContextRail poster={poster} program={railTitle} ancestors={ancestors} ring={ring}
        continue={railContinue} onContinue={() => cont && onPlay(cont.lesson)} />
      <div className="psc-pane">{pane}</div>
    </section>
  );
}
