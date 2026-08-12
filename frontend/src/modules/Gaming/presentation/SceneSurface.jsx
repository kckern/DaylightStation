import { useEffect, useMemo, useRef, useState } from 'react';
import { compileTopDownScene } from '@shared-presentation/index.mjs';
import { drawScenePlanToCanvas } from './canvasRenderer.js';
import './SceneSurface.scss';

export default function SceneSurface({ catalog, scene, resolveAssetUrl, className = '', onReady, onError }) {
  const canvasRef = useRef(null); const [error, setError] = useState(null);
  const plan = useMemo(() => compileTopDownScene(catalog, scene), [catalog, scene]);
  useEffect(() => {
    let cancelled = false;
    drawScenePlanToCanvas(canvasRef.current, catalog, plan, { resolveAssetUrl }).then((report) => {
      if (!cancelled) { setError(null); onReady?.({ plan, report }); }
    }).catch((cause) => {
      if (!cancelled) { setError(cause); onError?.(cause); }
    });
    return () => { cancelled = true; };
  }, [catalog, plan, resolveAssetUrl, onReady, onError]);
  return <canvas ref={canvasRef} className={`presentation-scene-surface ${className}`.trim()} role="img" aria-label={scene.id} data-plan-hash={plan.hash} data-render-error={error ? 'true' : undefined} />;
}
