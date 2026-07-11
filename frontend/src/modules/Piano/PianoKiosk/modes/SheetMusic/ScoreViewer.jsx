import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Score viewer — shows the selected sheet-music score's page image(s) in a
 * vertical scroll. A multi-page score resolves to its child pages via the list
 * endpoint; a single-image score falls back to its own image.
 */
export default function ScoreViewer({ score }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic-viewer' }), []);
  const [pages, setPages] = useState(null); // null = loading

  // Current location in the header breadcrumb (Sheet Music › this score).
  usePianoBreadcrumb(useMemo(() => [{ label: score?.title || 'Score' }], [score?.title]));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = idOf(score?.id);
        logger.info('piano.score-open', { id });
        const list = await DaylightAPI(`api/v1/list/plex/${id}`).catch(() => null);
        const children = (list?.items ?? [])
          .map((it) => it.image || it.thumbnail)
          .filter(Boolean);
        const resolved = children.length ? children : [score?.image || score?.thumbnail].filter(Boolean);
        if (!cancelled) setPages(resolved);
      } catch (err) {
        if (!cancelled) setPages([score?.image || score?.thumbnail].filter(Boolean));
        logger.warn('piano.score-open-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, score?.id, score?.image, score?.thumbnail]);

  return (
    <div className="piano-score-viewer">
      <div className="piano-score-viewer__pages">
        {pages === null && <SkeletonStage />}
        {pages?.length === 0 && <p className="piano-mode__placeholder">This score has no viewable pages.</p>}
        {pages?.map((src, i) => (
          <img key={i} className="piano-score-viewer__page" src={src} alt={`${score?.title || 'Score'} — page ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}
