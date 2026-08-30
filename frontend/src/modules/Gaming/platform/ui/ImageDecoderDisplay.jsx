import React, { useMemo } from 'react';
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
  const artifacts = useMemo(
    () => generateDecoderArtifacts(seed, artifactCount),
    [seed, artifactCount],
  );
  const maskImage = cssUrl(src);

  return (
    <figure className="image-decoder-display" role="img" aria-label={alt}>
      <div
        className="image-decoder-display__subject"
        data-testid="image-decoder-subject"
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
