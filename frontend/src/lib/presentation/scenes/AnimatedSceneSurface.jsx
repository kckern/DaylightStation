import { useEffect, useMemo, useRef, useState } from 'react';
import { compileTopDownScene } from '@shared-presentation/index.mjs';
import { createCanvasSceneRenderer } from './CanvasPlanRenderer.js';
import './SceneSurface.scss';

export default function AnimatedSceneSurface({ catalog, scene, commandsAtTime = (_elapsed, plan) => plan.commands, paused = false, className = '', onError }) {
  const canvasRef = useRef(null); const [error, setError] = useState(null);
  const plan = useMemo(() => compileTopDownScene(catalog, scene), [catalog, scene]);
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const renderer = createCanvasSceneRenderer(canvasRef.current, catalog); const started = performance.now(); let frame = null; let cancelled = false; let drawing = false;
    const tick = (now) => {
      if (cancelled) return;
      if (!drawing) {
        drawing = true;
        const commands = paused ? plan.commands : commandsAtTime(now - started, plan);
        renderer.draw(plan, { commands }).then(() => setError(null)).catch((cause) => { setError(cause); onError?.(cause); }).finally(() => { drawing = false; });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(frame); renderer.dispose(); };
  }, [catalog, commandsAtTime, onError, paused, plan]);
  return <canvas ref={canvasRef} className={`presentation-scene-surface ${className}`.trim()} role="img" aria-label={scene.id} data-plan-hash={plan.hash} data-render-error={error ? 'true' : undefined} />;
}
