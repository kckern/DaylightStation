import { useMemo, useState } from 'react';
import { collectFacets, filterByFacets, partsOf } from './subcourses.js';
import { partitionSongs, availableTreatments } from './repertoire.js';
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

/** Lessons of one treatment (or one skill challenge): ungated, part-sectioned. */
function TreatmentLessons({ lessons, onPlay }) {
  const ordered = useMemo(
    () => [...(lessons || [])].sort((a, b) => (Number(a?.itemIndex) || 0) - (Number(b?.itemIndex) || 0)),
    [lessons],
  );
  const sections = useMemo(() => partsOf({ lessons: ordered }), [ordered]);
  return <LessonList lessons={ordered} sections={sections} onPlay={onPlay} sequential={false} reference />;
}

/**
 * Song-first browser for the Repertoire lane. Level 1 is a searchable, faceted
 * song catalog (one card per piano.song, treatment chips) plus a Skill
 * Challenges shelf; level 2 a song page (Learn it / Master it / Comp it);
 * level 3 the treatment's lessons, part-sectioned and never gated. A song with
 * a single treatment opens it directly.
 */
export default function RepertoireBrowser({ season, onPlay }) {
  const items = season?.lessons || [];
  const facets = useMemo(() => collectFacets(items), [items]);
  const [selected, setSelected] = useState({ style: null, skill: null, instructor: null });
  const [query, setQuery] = useState('');
  // view: null | {song} | {song, treatment} | {challenge}
  const [view, setView] = useState(null);

  const toggle = (dim, val) => setSelected((s) => ({ ...s, [dim]: s[dim] === val ? null : val }));

  const catalog = useMemo(() => partitionSongs(filterByFacets(items, selected)), [items, selected]);
  const q = query.trim().toLowerCase();
  const songs = useMemo(
    () => (q ? catalog.songs.filter((s) => s.title.toLowerCase().includes(q)) : catalog.songs),
    [catalog, q],
  );
  const challenges = useMemo(
    () => (q ? catalog.skillChallenges.filter((c) => c.title.toLowerCase().includes(q)) : catalog.skillChallenges),
    [catalog, q],
  );

  const openSong = (song) => {
    const avail = availableTreatments(song);
    setView(avail.length === 1 ? { song, treatment: avail[0].key } : { song });
  };

  if (view?.challenge) {
    return (
      <div className="psc-repertoire">
        <button type="button" className="psc-repertoire__back" onClick={() => setView(null)}>◂ Songs</button>
        <h3 className="psc-song-head">{view.challenge.title}</h3>
        <TreatmentLessons lessons={view.challenge.lessons} onPlay={onPlay} />
      </div>
    );
  }

  if (view?.song && view.treatment) {
    const avail = availableTreatments(view.song);
    const t = avail.find((x) => x.key === view.treatment);
    return (
      <div className="psc-repertoire">
        <button type="button" className="psc-repertoire__back"
          onClick={() => setView(avail.length === 1 ? null : { song: view.song })}>
          ◂ {avail.length === 1 ? 'Songs' : view.song.title}
        </button>
        <h3 className="psc-song-head">{view.song.title} <span className="psc-song-head__t">{t?.chip}</span></h3>
        <TreatmentLessons lessons={view.song.treatments[view.treatment]} onPlay={onPlay} />
      </div>
    );
  }

  if (view?.song) {
    const avail = availableTreatments(view.song);
    return (
      <div className="psc-repertoire">
        <button type="button" className="psc-repertoire__back" onClick={() => setView(null)}>◂ Songs</button>
        <h3 className="psc-song-head">{view.song.title}</h3>
        <div className="psc-song-actions">
          {avail.map((t) => {
            const n = view.song.treatments[t.key].length;
            return (
              <button type="button" key={t.key} className={`psc-song-action psc-song-action--${t.key}`}
                onClick={() => setView({ song: view.song, treatment: t.key })}>
                <span className="psc-song-action__do">{t.action}</span>
                <span className="psc-song-action__sub">{t.chip} · {n} lesson{n === 1 ? '' : 's'}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="psc-repertoire">
      <input type="search" className="psc-repertoire__search" placeholder="Search songs…"
        value={query} onChange={(e) => setQuery(e.target.value)} />
      <ChipRow label="Style" options={facets.styles} value={selected.style} onToggle={(v) => toggle('style', v)} />
      <ChipRow label="Difficulty" options={facets.skills} value={selected.skill} onToggle={(v) => toggle('skill', v)} />
      <ChipRow label="Teacher" options={facets.instructors} value={selected.instructor} onToggle={(v) => toggle('instructor', v)} />
      {challenges.length > 0 && (
        <div className="psc-shelf">
          <h4 className="psc-shelf__title">Skill Challenges</h4>
          <div className="psc-shelf__row">
            {challenges.map((c) => (
              <button type="button" key={c.title} className="psc-shelf__card" onClick={() => setView({ challenge: c })}>
                <span className="psc-shelf__name">{c.title}</span>
                <span className="psc-shelf__sub">{c.lessons.length} lesson{c.lessons.length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="psc-repertoire__count">{songs.length} song{songs.length === 1 ? '' : 's'}</div>
      <ul className="psc-songs">
        {songs.map((s) => (
          <li key={s.title}>
            <button type="button" className="psc-song" onClick={() => openSong(s)} title={s.title}>
              <span className="psc-song__name">{s.title}</span>
              <span className="psc-song__chips">
                {availableTreatments(s).map((t) => (
                  <span key={t.key} className={`psc-song-chip psc-song-chip--${t.key}`}>{t.chip}</span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
