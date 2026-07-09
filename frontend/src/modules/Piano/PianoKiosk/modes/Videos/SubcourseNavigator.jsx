import { useMemo, useState } from 'react';
import { partitionSeasons } from './subcourses.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import SeasonMenu from './SeasonMenu.jsx';
import CourseList from './CourseList.jsx';
import CourseLessons from './CourseLessons.jsx';

/**
 * Drill-in for a "subcourses" program: Season menu → Course list → Lessons.
 * A season with exactly one course collapses straight to its lessons. Navigation
 * is internal state (season/course selection resets on reload — a kiosk lands
 * back on the season menu, consistent with the footer-Back-to-root convention);
 * lesson playback bubbles up via onPlay to the existing player route.
 */
export default function SubcourseNavigator({ course, playable, onPlay }) {
  const { items, parents, info } = playable || {};
  const seasons = useMemo(() => partitionSeasons(items, parents), [items, parents]);
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

  const crumbs = useMemo(() => {
    const out = [{ label: program, onClick: () => { setSeasonId(null); setFloor(null); } }];
    if (season) {
      out.push({
        label: season.title || `Season ${season.index}`,
        onClick: (activeCourse && !collapsed) ? () => setFloor(null) : undefined,
      });
    }
    if (activeCourse && !collapsed) out.push({ label: activeCourse.label });
    return out;
  }, [program, season, activeCourse, collapsed]);
  usePianoBreadcrumb(crumbs);

  let body;
  if (!season) {
    body = <SeasonMenu seasons={seasons} poster={poster} onSelect={(s) => { setSeasonId(s.id); setFloor(null); }} />;
  } else if (activeCourse) {
    body = <CourseLessons lessons={activeCourse.lessons} onPlay={onPlay} />;
  } else {
    body = <CourseList courses={season.courses} poster={poster} onSelect={(c) => setFloor(c.floor)} />;
  }

  return <section className="piano-mode--videos piano-course piano-subcourse">{body}</section>;
}
