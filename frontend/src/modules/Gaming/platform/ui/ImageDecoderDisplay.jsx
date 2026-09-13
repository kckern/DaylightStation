import React, { useMemo, useState } from 'react';
import { DEFAULT_ARTIFACT_COUNT, generateDecoderArtifacts } from './imageDecoderArtifacts.js';
import './ImageDecoderDisplay.scss';

function cssUrl(src) {
  return `url(${JSON.stringify(String(src || ''))})`;
}

export default function ImageDecoderDisplay({
  src,
  alt = 'Secret image clue',
  seed = src,
  artifactCount = DEFAULT_ARTIFACT_COUNT,
}) {
  const [failure, setFailure] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const failed = failure === src;
  const artifacts = useMemo(
    () => generateDecoderArtifacts(seed, artifactCount),
    [seed, artifactCount],
  );
  const resource = attempt ? `${src}${String(src).includes('?') ? '&' : '?'}decoder_retry=${attempt}` : src;
  const maskImage = cssUrl(resource);

  return (
    <figure className="image-decoder-display" data-status={failed ? "error" : loaded === `${src}:${attempt}` ? "ready" : "loading"} aria-label={alt}>
      <img key={`${src}:${attempt}`} className="image-decoder-display__probe" src={resource} alt="" aria-hidden="true" onLoad={() => { setFailure(null); setLoaded(`${src}:${attempt}`); }} onError={() => setFailure(src)} />
      {failed && <div className="image-decoder-display__error" role="alert">Clue image could not load.<button type="button" onClick={() => { setFailure(null); setAttempt(value => value + 1); }}>Retry image</button></div>}
      <div
        className="image-decoder-display__subject"
        data-testid="image-decoder-subject"
        role="img" aria-label={alt}
        style={{ maskImage, WebkitMaskImage: maskImage }}
      />
      <svg
        className="image-decoder-display__artifacts"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {artifacts.map((artifact) => (
          <ellipse
            key={artifact.id}
            className={`image-decoder-display__artifact is-${artifact.kind}`}
            cx={artifact.cx}
            cy={artifact.cy}
            rx={artifact.rx}
            ry={artifact.ry}
            opacity={artifact.opacity}
            transform={`rotate(${artifact.rotation} ${artifact.cx} ${artifact.cy})`}
          />
        ))}
      </svg>
    </figure>
  );
}
