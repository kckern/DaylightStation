import React, { useEffect, useMemo, useState } from 'react';
import { DEFAULT_ARTIFACT_COUNT, generateDecoderArtifacts, generateDecoderMotion, generateDecoderTexture } from './imageDecoderArtifacts.js';
import './ImageDecoderDisplay.scss';

function cssUrl(src) {
  return `url(${JSON.stringify(String(src || ''))})`;
}

export default function ImageDecoderDisplay({
  src,
  alt = 'Secret image clue',
  seed = src,
  artifactCount = DEFAULT_ARTIFACT_COUNT,
  motionIntervalMs = 1000,
}) {
  const [failure, setFailure] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [motionIndex, setMotionIndex] = useState(0);
  const failed = failure === src;
  const artifacts = useMemo(
    () => generateDecoderArtifacts(seed, artifactCount),
    [seed, artifactCount],
  );
  const texture = useMemo(() => generateDecoderTexture(seed), [seed]);
  const motion = useMemo(() => generateDecoderMotion(seed), [seed]);
  const tone = index => `var(--gp-decoder-noise-${index + 1})`;
  const resource = attempt ? `${src}${String(src).includes('?') ? '&' : '?'}decoder_retry=${attempt}` : src;
  const maskImage = cssUrl(resource);
  const frame = motion[motionIndex % motion.length];

  useEffect(() => {
    setMotionIndex(0);
    if (!Number.isFinite(motionIntervalMs) || motionIntervalMs <= 0) return undefined;
    const timer = setInterval(() => setMotionIndex(index => (index + 1) % motion.length), motionIntervalMs);
    return () => clearInterval(timer);
  }, [motion.length, motionIntervalMs, seed]);

  return (
    <figure className="image-decoder-display" data-status={failed ? "error" : loaded === `${src}:${attempt}` ? "ready" : "loading"} data-motion-index={motionIndex} aria-label={alt} style={{
      transform: `translate3d(${frame.x.toFixed(2)}%, ${frame.y.toFixed(2)}%, 0)`,
    }}>
      <img key={`${src}:${attempt}`} className="image-decoder-display__probe" src={resource} alt="" aria-hidden="true" onLoad={() => { setFailure(null); setLoaded(`${src}:${attempt}`); }} onError={() => setFailure(src)} />
      {failed && <div className="image-decoder-display__error" role="alert">Clue image could not load.<button type="button" onClick={() => { setFailure(null); setAttempt(value => value + 1); }}>Retry image</button></div>}
      <div className="image-decoder-display__composite" data-testid="image-decoder-composite">
        <div
          className="image-decoder-display__subject"
          data-testid="image-decoder-subject"
          role="img" aria-label={alt}
          style={{
            maskImage,
            WebkitMaskImage: maskImage,
            opacity: frame.subjectOpacity.toFixed(3),
            transform: `scaleX(${frame.mirrored ? -1 : 1}) scale(${frame.subjectScale.toFixed(3)})`,
          }}
          data-mirrored={frame.mirrored}
          data-subject-scale={frame.subjectScale.toFixed(3)}
          data-subject-opacity={frame.subjectOpacity.toFixed(3)}
        />
        <svg
          className="image-decoder-display__artifacts"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          data-interference-rotation={motionIndex * 90}
          style={{ transform: `rotate(${motionIndex * 90}deg)` }}
        >
          {texture.tiles.map(tile => <rect key={`tile:${tile.id}`} className="image-decoder-display__texture-tile"
            x={tile.x} y={tile.y} width={4.1} height={4.1} fill={tone(tile.tone)} opacity={tile.opacity} />)}
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
          {texture.streaks.map(streak => <line key={`streak:${streak.id}`} className="image-decoder-display__streak"
            x1={streak.x1} y1={streak.y1} x2={streak.x2} y2={streak.y2} stroke={tone(streak.tone)} strokeWidth={streak.width} />)}
        </svg>
      </div>
    </figure>
  );
}
