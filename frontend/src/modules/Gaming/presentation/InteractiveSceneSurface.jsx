import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { compileTopDownScene } from '@shared-presentation/index.mjs';
import { createCanvasSceneRenderer } from './canvasRenderer.js';
import {
  actorCommands,
  actorPlaybackInfo,
  animateSceneCommands,
  clipDurationMs,
  equipmentForAssembly,
  findWalkableSpawn,
  interactivePlacements,
  moveActor,
  nearestInteractive,
} from './interactiveModel.js';
import { usePresentationInput } from './usePresentationInput.js';
import './SceneSurface.scss';

function compile(catalog, scene) {
  try { return { plan: compileTopDownScene(catalog, scene), error: null }; }
  catch (error) { return { plan: null, error }; }
}

function facingForAction(action, fallback) {
  return { 'move.north': 'north', 'move.east': 'east', 'move.south': 'south', 'move.west': 'west' }[action] ?? fallback;
}

const InteractiveSceneSurface = forwardRef(function InteractiveSceneSurface({
  catalog,
  scene,
  actorChoice,
  actorState = 'idle',
  assemblyId = '',
  animateWorld = true,
  paused = false,
  reducedMotion = false,
  showGrid = false,
  className = '',
  onInspect,
  onRuntime,
  onError,
  onTogglePause,
  onRequestNextState,
  onActorStateComplete,
}, forwardedRef) {
  const canvasRef = useRef(null); const rendererRef = useRef(null); const positionRef = useRef([0, 0]); const facingRef = useRef('south');
  const heldRef = useRef(new Set()); const objectStatesRef = useRef({}); const selectedCommandRef = useRef(null); const [renderError, setRenderError] = useState(null);
  const actorPlaybackRef = useRef({ key: '', startedAt: 0, completed: false });
  const compiled = useMemo(() => compile(catalog, scene), [catalog, scene]); const plan = compiled.plan;
  const interactives = useMemo(() => plan ? interactivePlacements(catalog, plan) : [], [catalog, plan]);
  const equipment = useMemo(() => equipmentForAssembly(actorChoice, assemblyId), [actorChoice, assemblyId]);

  useEffect(() => {
    if (!plan) { onError?.(compiled.error); return; }
    positionRef.current = findWalkableSpawn(plan); objectStatesRef.current = {}; selectedCommandRef.current = null;
  }, [compiled.error, onError, plan]);

  const triggerInteraction = useCallback((timestamp) => {
    if (!plan) return;
    const target = nearestInteractive(interactives, positionRef.current);
    if (!target) { onRequestNextState?.(); return; }
    const asset = catalog.assets[target.asset]; const current = objectStatesRef.current[target.key]?.state ?? asset.animation?.default_state;
    const transitionId = target.transitions.find((id) => asset.animation.transitions[id].from === current) ?? target.transitions[0];
    if (!transitionId) { selectedCommandRef.current = target.command; onInspect?.({ type: 'placement', ...target }); return; }
    const transition = asset.animation.transitions[transitionId];
    objectStatesRef.current = { ...objectStatesRef.current, [target.key]: { transition: transitionId, from: transition.from, to: transition.to, startedAt: timestamp } };
    selectedCommandRef.current = target.command; onInspect?.({ type: 'interaction', ...target, transition: transitionId });
  }, [catalog, interactives, onInspect, onRequestNextState, plan]);

  const handleAction = useCallback((event) => {
    if (event.action.startsWith('move.')) {
      if (event.phase === 'release') heldRef.current.delete(event.action); else heldRef.current.add(event.action);
      facingRef.current = facingForAction(event.action, facingRef.current); return;
    }
    if (event.phase !== 'press') return;
    if (event.action === 'action.primary') triggerInteraction(event.timestamp);
    else if (event.action === 'action.secondary') onRequestNextState?.();
    else if (event.action === 'pause') onTogglePause?.();
  }, [onRequestNextState, onTogglePause, triggerInteraction]);
  const input = usePresentationInput({ enabled: Boolean(plan), onAction: handleAction });
  useImperativeHandle(forwardedRef, () => ({ dispatch: input.dispatch, gamepads: input.gamepads, reset() { if (plan) positionRef.current = findWalkableSpawn(plan); } }), [input.dispatch, input.gamepads, plan]);

  useEffect(() => {
    if (!plan || !canvasRef.current) return undefined;
    const canvas = canvasRef.current; canvas.dataset.runtimePhase = 'setup';
    const renderer = createCanvasSceneRenderer(canvas, catalog); rendererRef.current = renderer;
    let animationFrame = null; let previous = performance.now(); let elapsed = 0; let drawing = false; let lastReport = 0; let cancelled = false;
    const tick = (timestamp) => {
      if (cancelled) return;
      canvas.dataset.runtimePhase = 'tick';
      const delta = Math.min(50, timestamp - previous); previous = timestamp; if (!paused) elapsed += delta;
      const movement = [...heldRef.current]; const moving = movement.length > 0 && !paused;
      if (moving) {
        const direction = movement.reduce((sum, action) => {
          if (action === 'move.west') sum[0] -= 1; if (action === 'move.east') sum[0] += 1;
          if (action === 'move.north') sum[1] -= 1; if (action === 'move.south') sum[1] += 1; return sum;
        }, [0, 0]);
        const length = Math.hypot(...direction) || 1; const speed = 42 * delta / 1000;
        positionRef.current = moveActor(plan, positionRef.current, [direction[0] / length * speed, direction[1] / length * speed]);
      }
      for (const [key, value] of Object.entries(objectStatesRef.current)) if (value.transition) {
        const item = interactives.find((entry) => entry.key === key); const asset = item && catalog.assets[item.asset]; const clipId = asset?.animation?.transitions?.[value.transition]?.clip;
        if (timestamp - value.startedAt >= clipDurationMs(asset?.clips?.[clipId])) objectStatesRef.current = { ...objectStatesRef.current, [key]: { state: value.to, startedAt: timestamp } };
      }
      if (!drawing) {
        drawing = true; canvas.dataset.runtimePhase = 'loading-assets';
        const state = moving && actorChoice?.states?.includes('run') ? 'run' : actorState;
        const playbackKey = `${actorChoice?.id ?? ''}:${assemblyId}:${state}`;
        if (actorPlaybackRef.current.key !== playbackKey) actorPlaybackRef.current = { key: playbackKey, startedAt: elapsed, completed: false };
        const actorElapsed = elapsed - actorPlaybackRef.current.startedAt;
        const sceneCommands = animateWorld ? animateSceneCommands(catalog, plan, elapsed, { objectStates: objectStatesRef.current, reducedMotion }) : plan.commands;
        let overlays = [];
        try {
          overlays = actorCommands(catalog, actorChoice, { at: positionRef.current, state, facing: facingRef.current, moving, equipment, elapsedMs: actorElapsed, reducedMotion });
          const playback = actorPlaybackInfo(catalog, actorChoice, { state, facing: facingRef.current, moving, equipment });
          if (playback?.once && !actorPlaybackRef.current.completed && actorElapsed >= playback.durationMs) {
            actorPlaybackRef.current.completed = true; onActorStateComplete?.({ state, ...playback });
          }
        }
        catch (error) { setRenderError(error); onError?.(error); }
        renderer.draw(plan, { commands: sceneCommands, overlays, showGrid, selectedCommand: selectedCommandRef.current }).then((report) => {
          if (!cancelled) {
            canvas.dataset.runtimePhase = 'ready';
            setRenderError(null);
            if (timestamp - lastReport > 200) { lastReport = timestamp; onRuntime?.({ ...report, position: positionRef.current, facing: facingRef.current, moving, state, nearby: nearestInteractive(interactives, positionRef.current)?.asset ?? null, gamepads: input.gamepads.length }); }
          }
        }).catch((error) => { if (!cancelled) { canvas.dataset.runtimePhase = 'error'; setRenderError(error); onError?.(error); } }).finally(() => { drawing = false; });
      }
      animationFrame = requestAnimationFrame(tick);
    };
    // Paint once synchronously so a backgrounded kiosk/tab is never left with
    // the browser's default blank canvas while requestAnimationFrame is gated.
    tick(performance.now());
    return () => { cancelled = true; if (animationFrame !== null) cancelAnimationFrame(animationFrame); renderer.dispose(); rendererRef.current = null; };
  }, [actorChoice, actorState, animateWorld, assemblyId, catalog, equipment, input.gamepads.length, interactives, onActorStateComplete, onError, onRuntime, paused, plan, reducedMotion, showGrid]);

  const inspectPoint = useCallback((event) => {
    if (!plan) return;
    const rect = event.currentTarget.getBoundingClientRect(); const at = [(event.clientX - rect.left) / rect.width * plan.logical_size[0], (event.clientY - rect.top) / rect.height * plan.logical_size[1]];
    const commands = plan.commands.filter((command) => command.type === 'sprite');
    const command = commands.map((entry) => ({ entry, distance: Math.hypot(entry.at[0] - at[0], entry.at[1] - at[1]) })).sort((a, b) => a.distance - b.distance)[0]?.entry;
    selectedCommandRef.current = command ?? null; if (command) onInspect?.({ type: 'command', command, asset: command.asset, frame: command.frame, at });
  }, [onInspect, plan]);

  if (compiled.error) return <div className="presentation-scene-surface__error" role="alert">{compiled.error.message}</div>;
  return <canvas ref={canvasRef} className={`presentation-scene-surface presentation-scene-surface--interactive ${className}`.trim()} role="img" aria-label={`${scene.id} interactive game scene`} data-plan-hash={plan.hash} data-render-error={renderError ? 'true' : undefined} onPointerDown={inspectPoint} />;
});

export default InteractiveSceneSurface;
