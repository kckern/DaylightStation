import { useEffect, useState } from 'react';
import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';
import { balancedColumns } from '../../tileGridLayout.js';
import { SkeletonPoster } from '../../Skeleton.jsx';
import { prefetchOsmd } from '../../../../MusicNotation/renderers/osmdRender.js';
import { prettyTitle } from './scoreTitle.js';

// Last-selected tab (by label), so a walk-up user lands where they left off.
// Same guarded-localStorage discipline as scoreSettings.js.
const TAB_KEY = 'daylight.piano.sm.tab';
const loadTab = () => { try { return window.localStorage.getItem(TAB_KEY); } catch { return null; } };
const saveTab = (label) => { try { window.localStorage.setItem(TAB_KEY, label); } catch { /* storage unavailable */ } };

/**
 * Grid of scores from one or more configured folders (`sheetmusic.collections`
 * tabs — the Courses menu's model). One group renders the tabless grid; two or
 * more add a Courses-style tab strip (same .piano-course-tab language) with one
 * folder per tab. MusicXML scores are engraved (interactive); scanned
 * page-image scores show their cover. Tap a score to open it.
 *
 * @param {Array<{label: string|null, listPath: string}>} groups
 * @param {(item: object) => void} onSelect
 */
export default function ScoreGrid({ groups = [], onSelect }) {
  // Restore the remembered tab; a label that no longer exists falls back to 0.
  const [tabIdx, setTabIdx] = useState(() => {
    const i = groups.findIndex((g) => g.label != null && g.label === loadTab());
    return i >= 0 ? i : 0;
  });
  const active = groups[Math.min(tabIdx, groups.length - 1)] ?? null;
  const { data: items, error } = usePianoList(active?.listPath ?? null);
  const all = items ?? [];
  const loading = items === null;

  // Warm the OSMD engine now, while the user is still choosing a score, so the
  // heavy engraving chunk is loaded before they open one (cuts first-open lag).
  useEffect(() => { prefetchOsmd().catch(() => {}); }, []);

  const pickTab = (i) => {
    setTabIdx(i);
    if (groups[i]?.label) saveTab(groups[i].label);
  };

  return (
    <section className="piano-mode piano-mode--sheetmusic">
      {groups.length > 1 && (
        <div className="piano-course-tabs" role="tablist" aria-label="Score collections">
          {groups.map((g, i) => (
            <button
              key={g.label ?? i}
              type="button"
              role="tab"
              aria-selected={i === tabIdx}
              className={`piano-course-tab${i === tabIdx ? ' is-active' : ''}`}
              onClick={() => pickTab(i)}
            >
              {g.label ?? 'Scores'}
            </button>
          ))}
        </div>
      )}
      {loading && <SkeletonPoster count={8} />}
      {!loading && all.length === 0 && (
        <PianoEmpty message={error || (active ? 'No scores found.' : 'No sheet music has been set up yet.')} />
      )}
      {all.length > 0 && (
        <ul
          className="piano-video-grid piano-video-grid--posters"
          style={{ '--poster-cols': balancedColumns(all.length, { max: 5 }) }}
        >
          {all.map((item) => {
            const cover = item.thumbnail || item.image;
            const title = item.type === 'notation' ? prettyTitle(item.title) : (item.title || 'Score');
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`piano-video-grid__tile${item.type === 'notation' ? ' piano-score-tile--builtin' : ''}`}
                  onClick={() => onSelect({ ...item, title })}
                  title={title}
                >
                  {cover
                    ? <img src={cover} alt={title} loading="lazy" decoding="async" />
                    : <span className="piano-score-tile__label">{title}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
