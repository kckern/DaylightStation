// The weekly showcase: one slide per child closing the window's last day.
// A collage of the week's pinned prints on the left, and on the right what the
// child did this week, as a few short bullets.
import React, { useCallback, useEffect, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import WorkImage from './WorkImage.jsx';
import { kidStyle } from './schoolWork.js';

let _l;
const logger = () => (_l ||= getLogger().child({ component: 'weekly-review-showcase' }));

const TILTS = [-3, 2, -1, 3, -2, 1];
const STAGGER_MS = 80;
const CROSSFADE_MS = 200;
const MAX_IMAGES = 6;
const MAX_BULLETS = 5;

// One layout per count, none with a hole: 3 is a large print with two stacked
// beside it, 5 is three over two centred.
const COLLAGE_CLASS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
function collageClass(count) {
  return `showcase-collage--${COLLAGE_CLASS[Math.min(Math.max(count, 1), MAX_IMAGES)]}`;
}

function Bullets({ bullets }) {
  return (
    <ul className="showcase-bullets">
      {bullets.map((b, i) => (
        <li key={i} className="showcase-bullet">
          <span className="showcase-bullet-marker" aria-hidden="true" />
          <span className="showcase-bullet-text">{b}</span>
        </li>
      ))}
    </ul>
  );
}

// When drafted bullets replace the plain ones while the slide is up, the old
// list fades out over the new one in the same grid cell, so nothing jumps.
function BulletStack({ bullets }) {
  const sig = bullets.join('\n');
  const [state, setState] = useState({ sig, bullets, prev: null });
  if (state.sig !== sig) setState({ sig, bullets, prev: state.bullets });

  useEffect(() => {
    if (!state.prev) return undefined;
    const t = setTimeout(() => setState(s => ({ ...s, prev: null })), CROSSFADE_MS);
    return () => clearTimeout(t);
  }, [state.prev]);

  return (
    <div className="showcase-bullet-stack">
      {state.prev && (
        <div className="showcase-bullet-layer showcase-bullet-layer--out" aria-hidden="true">
          <Bullets bullets={state.prev} />
        </div>
      )}
      <div key={state.sig} className={`showcase-bullet-layer${state.prev ? ' showcase-bullet-layer--in' : ''}`}>
        <Bullets bullets={state.bullets} />
      </div>
    </div>
  );
}

export default function ShowcaseSlide({ item, index, total, color }) {
  // A print whose image fails leaves the collage, which reflows to the new
  // count; if every image fails the slide takes the no-images layout.
  const [failedUrls, setFailedUrls] = useState(() => new Set());
  const onFail = useCallback((url) => {
    setFailedUrls(prev => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);
  // Keys come from the original position, so a reflow keeps the survivors
  // mounted (no replayed entrance).
  const images = (item?.images || []).filter(Boolean).slice(0, MAX_IMAGES)
    .map((url, i) => ({ url, key: `${i}:${url}` }))
    .filter(({ url }) => !failedUrls.has(url));
  const bullets = (item?.bullets || []).filter(Boolean).slice(0, MAX_BULLETS);

  useEffect(() => {
    if (!item) return;
    logger().debug('reel.showcase', {
      learnerId: item.learnerId, images: images.length, bullets: bullets.length, source: item.source,
    });
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;
  const name = item.learnerName || '';
  return (
    <div
      className={`weekly-review-showcase${images.length ? '' : ' weekly-review-showcase--no-images'}`}
      style={kidStyle(color)}
    >
      <span className="showcase-band" aria-hidden="true" />
      {images.length > 0 && (
        <div className={`showcase-collage ${collageClass(images.length)}`}>
          {images.map(({ url, key }, i) => (
            <div
              key={key}
              className="showcase-print"
              style={{ '--tilt': `${TILTS[i % TILTS.length]}deg`, animationDelay: `${i * STAGGER_MS}ms` }}
            >
              <WorkImage item={{ imageUrl: url, title: '', subject: null }} alt="" onFail={onFail} />
            </div>
          ))}
        </div>
      )}
      <div className="showcase-text">
        <h2 className="showcase-title">{`${name}'s School Work This Week`}</h2>
        {bullets.length > 0 && <BulletStack bullets={bullets} />}
      </div>
      {total > 0 && <div className="work-card-index fullscreen-image-index">{index + 1} / {total}</div>}
    </div>
  );
}
