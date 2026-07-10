import { useMemo, useState } from 'react';
import { collectFacets, filterByFacets, partitionCourses } from './subcourses.js';
import CourseCards from './CourseCards.jsx';
import LessonList from './LessonList.jsx';

function ChipRow({ label, options, value, onToggle }) {
  if (!options || !options.length) return null;
  return (
    <div className="psc-repertoire__facet">
      <span className="psc-repertoire__facet-label">{label}</span>
      <div className="psc-repertoire__chips">
        {options.map((opt) => (
          <button type="button" key={opt} className={`psc-chip${value === opt ? ' is-on' : ''}`}
            aria-pressed={value === opt} onClick={() => onToggle(opt)}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Faceted browser for a repertoire season: a search box + style/skill/instructor
 * chip filters over the season's pool of items, regrouped into "songs" (via
 * partitionCourses, keyed by item.piano.course). Repertoire is never gated —
 * selecting a song shows its lessons unlocked (sequential=false, reference).
 */
export default function RepertoireBrowser({ season, onPlay }) {
  const items = season?.lessons || [];
  const facets = useMemo(() => collectFacets(items), [items]);
  const [selected, setSelected] = useState({ style: null, skill: null, instructor: null });
  const [query, setQuery] = useState('');
  const [selectedLabel, setSelectedLabel] = useState(null);

  const toggle = (dim, val) => setSelected((s) => ({ ...s, [dim]: s[dim] === val ? null : val }));

  const filtered = useMemo(() => {
    const byFacet = filterByFacets(items, selected);
    if (!query) return byFacet;
    const q = query.toLowerCase();
    return byFacet.filter((it) => (it.piano?.course || it.title || '').toLowerCase().includes(q));
  }, [items, selected, query]);

  const songs = useMemo(() => partitionCourses(filtered), [filtered]);
  const selectedSong = selectedLabel ? songs.find((s) => s.label === selectedLabel) : null;

  if (selectedSong) {
    return (
      <div className="psc-repertoire">
        <button type="button" className="psc-repertoire__back" onClick={() => setSelectedLabel(null)}>◂ Songs</button>
        <LessonList lessons={selectedSong.lessons} onPlay={onPlay} sequential={false} reference />
      </div>
    );
  }

  return (
    <div className="psc-repertoire">
      <input
        type="search"
        className="psc-repertoire__search"
        placeholder="Search songs…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ChipRow label="Style" options={facets.styles} value={selected.style} onToggle={(v) => toggle('style', v)} />
      <ChipRow label="Difficulty" options={facets.skills} value={selected.skill} onToggle={(v) => toggle('skill', v)} />
      <ChipRow label="Teacher" options={facets.instructors} value={selected.instructor} onToggle={(v) => toggle('instructor', v)} />
      <div className="psc-repertoire__count">{songs.length} song{songs.length === 1 ? '' : 's'}</div>
      <CourseCards season={{ index: season?.index, courses: songs }} onSelect={(c) => setSelectedLabel(c.label)} />
    </div>
  );
}
