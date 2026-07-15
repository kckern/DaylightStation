import { useMemo, useState, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Score viewer — shows a scanned sheet-music score's page image(s) in a vertical
 * scroll. Because a deep link / reload carries only the content id in the URL, the
 * viewer resolves its OWN metadata: `info` for the title + a cover fallback (audit
 * H3), and `list` for the child page images. A load failure offers a retry (M6);
 * pages load lazily (M7).
 */
export default function ScoreViewer({ score }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic-viewer' }), []);
  const [pages, setPages] = useState(null); // null = loading, [] = none, [...] = pages
  const [title, setTitle] = useState(score?.title || null);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Breadcrumb reflects the resolved title (falls back to the passed one / "Score").
  usePianoBreadcrumb(useMemo(() => [{ label: title || 'Score' }], [title]));

  useEffect(() => {
    let cancelled = false;
    const id = idOf(score?.id);
    setPages(null); setFailed(false);
    // A pre-resolved sidecar/cover image (passed by the route) is shown directly —
    // no info/list round-trip. This is how a score's same-basename .jpg scan renders.
    const preImage = score?.image || score?.thumbnail;
    if (preImage) {
      logger.info('piano.score-open', { id, kind: 'image' });
      setPages([preImage]);
    } else {
      (async () => {
        try {
          logger.info('piano.score-open', { id });
          // Info (title + cover) and pages resolve in parallel; a missing info is not
          // fatal (the list may still have pages), so info failures degrade to null.
          const [info, list] = await Promise.all([
            DaylightAPI(`api/v1/info/plex/${id}`).catch(() => null),
            DaylightAPI(`api/v1/list/plex/${id}`).catch(() => null),
          ]);
          if (cancelled) return;
          if (!info && !list) throw new Error('both info and list failed');
          if (info?.title) setTitle(info.title);
          const children = (list?.items ?? [])
            .map((it) => it.image || it.thumbnail)
            .filter(Boolean);
          const cover = info?.image || info?.thumbnail;
          setPages(children.length ? children : [cover].filter(Boolean));
        } catch (err) {
          if (cancelled) return;
          logger.warn('piano.score-open-failed', { id, error: err.message });
          setFailed(true);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [logger, score?.id, score?.image, score?.thumbnail, retryKey]);

  const onRetry = useCallback(() => setRetryKey((k) => k + 1), []);

  if (failed) {
    return <PianoEmpty message="Couldn't load this score." actionLabel="Try again" onAction={onRetry} />;
  }

  return (
    <div className="piano-score-viewer">
      <div className="piano-score-viewer__pages">
        {pages === null && <SkeletonStage />}
        {pages?.length === 0 && <p className="piano-mode__placeholder">This score has no viewable pages.</p>}
        {pages?.map((src, i) => (
          <img
            key={i}
            className="piano-score-viewer__page"
            src={src}
            alt={`${title || 'Score'} — page ${i + 1}`}
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
    </div>
  );
}
