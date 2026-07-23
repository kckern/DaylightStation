/**
 * CollectionDetail — an audio anthology (Shakespeare Tales, I Survived) opened
 * from the shelf. The anthology is ONE tile; here it fans out into its works
 * (plays / books), laid out like the video course browser: the collection
 * poster + context on the left, a grid of square work tiles on the right.
 * Selecting a work opens that work's chapter list (`onOpenWork`).
 *
 * Purely presentational — MaterialsSection owns the selection and the
 * breadcrumb; this component only fetches and renders the works.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';

export default function CollectionDetail({ collection, onOpenWork, initialWorkId = null }) {
  const [works, setWorks] = useState(null);

  useEffect(() => {
    let alive = true;
    setWorks(null);
    schoolApi.materialWorks(collection.id).then(({ ok, data }) => {
      if (!alive) return;
      setWorks(ok && Array.isArray(data) ? data : []);
    });
    return () => { alive = false; };
  }, [collection.id]);

  // Deep-link restore: once the works resolve, auto-open the one the URL named
  // (one-shot per requested id) so a leaf URL descends past the works browser.
  const consumedRef = useRef(null);
  useEffect(() => {
    if (!initialWorkId || !works || consumedRef.current === initialWorkId) return;
    const w = works.find((x) => x.id === initialWorkId);
    if (w) { consumedRef.current = initialWorkId; onOpenWork(w); }
  }, [initialWorkId, works, onOpenWork]);

  return (
    <div className="school-material-detail">
      <div className="school-material-detail__layout">
        <aside className="school-material-detail__info">
          {collection.poster && (
            <img className="school-material-detail__poster" src={collection.poster} alt="" />
          )}
          <h2 className="school-material-detail__title">{collection.title}</h2>
          {works !== null && (
            <p className="school-material-detail__progress-line">
              {works.length} {works.length === 1 ? 'work' : 'works'}
            </p>
          )}
        </aside>
        <div className="school-material-detail__units-panel">
          {works === null && <div className="school-material-detail__loading">Loading…</div>}
          {works !== null && works.length === 0 && (
            <div className="school-material-detail__empty">Nothing here yet.</div>
          )}
          {works !== null && works.length > 0 && (
            <ul className="school-material-detail__works">
              {works.map((w) => (
                <li key={w.id}>
                  <button type="button" className="school-materials__tile school-materials__tile--square" onClick={() => onOpenWork(w)}>
                    {w.poster ? (
                      <img className="school-materials__poster" src={w.poster} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <div className="school-materials__poster school-materials__poster--placeholder"><span>{w.title}</span></div>
                    )}
                    <h3 className="school-materials__title">{w.title}</h3>
                    {w.unitCount != null && <p className="school-materials__meta">{w.unitCount} chapters</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
