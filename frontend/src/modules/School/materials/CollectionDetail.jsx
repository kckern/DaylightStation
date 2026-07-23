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
import { sizedPlexImage, ART_BOX } from '../plexImage.js';

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

  if (works === null) {
    return (
      <div className="school-material-detail">
        <div className="school-material-detail__layout school-skel" aria-hidden="true">
          <aside className="school-material-detail__info">
            <div className="school-skel__poster" />
            <div className="school-skel__line school-skel__line--sm" />
          </aside>
          <ul className="school-material-detail__works">
            {Array.from({ length: 8 }).map((_, i) => <li key={i}><span className="school-skel__tile" /></li>)}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="school-material-detail">
      <div className="school-material-detail__layout">
        <aside className="school-material-detail__info">
          {collection.poster && (
            <img className="school-material-detail__poster" src={sizedPlexImage(collection.poster, ...ART_BOX.detailPoster)} alt="" />
          )}
          {/* No title here — the header breadcrumb already names this collection. */}
          <p className="school-material-detail__progress-line">
            {works.length} {works.length === 1 ? 'work' : 'works'}
          </p>
        </aside>
        <div className="school-material-detail__units-panel">
          {works.length === 0 && (
            <div className="school-material-detail__empty">Nothing here yet.</div>
          )}
          {works !== null && works.length > 0 && (
            <ul className="school-material-detail__works">
              {works.map((w) => (
                <li key={w.id}>
                  <button type="button" className="school-materials__tile school-materials__tile--square" onClick={() => onOpenWork(w)}>
                    {w.poster ? (
                      <img className="school-materials__poster" src={sizedPlexImage(w.poster, ...ART_BOX.gridSquare)} alt="" loading="lazy" decoding="async" />
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
