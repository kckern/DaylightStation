import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import InteractiveSceneSurface from '../modules/Gaming/presentation/InteractiveSceneSurface.jsx';
import { createCanvasSceneRenderer } from '../modules/Gaming/presentation/canvasRenderer.js';
import { createPresentationApi } from '../modules/Gaming/presentation/presentationApi.js';
import {
  DEMO_THEME_TAGS,
  actorChoices,
  animateSceneCommands,
  catalogCoverage,
  equipmentForAssembly,
  statesForAssembly,
} from '../modules/Gaming/presentation/interactiveModel.js';
import { PRESENTATION_DPAD } from '../modules/Gaming/presentation/usePresentationInput.js';
import './GameDemoApp.scss';

const PACK_ID = 'showcase-v2';
const CATEGORY_FILTERS = ['all', 'actor', 'enemy', 'animal', 'structure', 'terrain', 'prop', 'item', 'effect', 'animation-layer'];

function titleCase(value) {
  return String(value ?? '').replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function assetMatchesCategory(asset, category) {
  if (category === 'all') return true;
  if (category === 'animation-layer') return asset.tags?.includes('animation-layer');
  return asset.tags?.includes(category) || asset.world?.scale_class === category;
}

function assetMatchesTheme(id, asset, theme) {
  if (theme === 'all') return true;
  return id.startsWith(`${theme}.`) || asset.tags?.includes(theme) || id.includes(`.${theme}.`);
}

function firstPreviewFrame(asset) {
  const state = asset.animation?.states?.[asset.animation.default_state]; const reference = state?.clip ?? Object.values(state?.facings ?? {})[0];
  const clipId = typeof reference === 'string' ? reference : reference?.clip;
  return asset.clips?.[clipId]?.frames?.[0] ?? asset.animation?.default_frame ?? Object.keys(asset.frames ?? {})[0];
}

function AssetPreview({ catalog, assetId, reducedMotion }) {
  const canvasRef = useRef(null); const asset = catalog.assets[assetId];
  useEffect(() => {
    if (!canvasRef.current || !asset) return undefined;
    const renderer = createCanvasSceneRenderer(canvasRef.current, catalog); const frameId = firstPreviewFrame(asset); let raf = null; let cancelled = false; let drawing = false;
    const plan = { schema_version: 2, kind: 'presentation-draw-plan', scene: 'asset-preview', catalog: PACK_ID, style_profile: asset.style_profile, logical_size: [160, 112], pixel_scale: 2, background: '#121822', grid: { cell: [16, 16], columns: 10, rows: 7 }, commands: [{ type: 'sprite', asset: assetId, frame: frameId, at: [80, 96], source_cell_offset: [0, 0], flip_x: false, rotation: 0, opacity: 1, render_layer: 'actor', sort_y: 96, provenance: 'preview' }], hash: `preview-${assetId}` };
    const start = performance.now();
    const tick = (timestamp) => {
      if (cancelled) return;
      if (!drawing) {
        drawing = true; const commands = animateSceneCommands(catalog, plan, timestamp - start, { reducedMotion });
        renderer.draw(plan, { commands }).catch(() => {}).finally(() => { drawing = false; });
      }
      raf = requestAnimationFrame(tick);
    };
    tick(performance.now()); return () => { cancelled = true; if (raf !== null) cancelAnimationFrame(raf); renderer.dispose(); };
  }, [asset, assetId, catalog, reducedMotion]);
  return <canvas ref={canvasRef} className="game-demo__asset-canvas" role="img" aria-label={`${assetId} sprite preview`} />;
}

function Toggle({ checked, onChange, children }) {
  return <label className="game-demo__toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{children}</span></label>;
}

export default function GameDemoApp({ clear = null }) {
  useDocumentTitle('Game Framework Demo');
  const api = useMemo(() => createPresentationApi(), []); const surfaceRef = useRef(null); const sceneTimerRef = useRef(null);
  const [catalog, setCatalog] = useState(null); const [sceneIndex, setSceneIndex] = useState([]); const [scene, setScene] = useState(null);
  const [sceneId, setSceneId] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [actorId, setActorId] = useState(''); const [actorState, setActorState] = useState('idle'); const [assemblyId, setAssemblyId] = useState('');
  const [paused, setPaused] = useState(false); const [animateWorld, setAnimateWorld] = useState(true); const [showGrid, setShowGrid] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false); const [autoScenes, setAutoScenes] = useState(false);
  const [runtime, setRuntime] = useState(null); const [inspection, setInspection] = useState(null);
  const [themeFilter, setThemeFilter] = useState('all'); const [categoryFilter, setCategoryFilter] = useState('all'); const [assetSearch, setAssetSearch] = useState(''); const [selectedAssetId, setSelectedAssetId] = useState('');

  const loadScene = useCallback(async (nextSceneId) => {
    setLoading(true); setError(null);
    try { const loaded = await api.getScene(PACK_ID, nextSceneId); setScene(loaded); setSceneId(nextSceneId); setInspection(null); }
    catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getCatalog(PACK_ID), api.getScenes(PACK_ID)]).then(([loadedCatalog, index]) => {
      if (cancelled) return;
      setCatalog(loadedCatalog); setSceneIndex(index.scenes); const requested = new URLSearchParams(window.location.search).get('scene');
      const initial = index.scenes.some((entry) => entry.id === requested) ? requested : index.scenes[0]?.id;
      if (!initial) throw new Error('The presentation catalog has no mounted demo scenes');
      return api.getScene(PACK_ID, initial).then((loaded) => { if (!cancelled) { setScene(loaded); setSceneId(initial); setLoading(false); } });
    }).catch((cause) => { if (!cancelled) { setError(cause); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api]);

  const actors = useMemo(() => catalog ? actorChoices(catalog) : [], [catalog]);
  const actor = useMemo(() => actors.find((choice) => choice.id === actorId) ?? actors[0] ?? null, [actorId, actors]);
  useEffect(() => { if (!actorId && actors[0]) setActorId(actors[0].id); }, [actorId, actors]);
  const availableStates = useMemo(() => catalog && actor ? statesForAssembly(catalog, actor, assemblyId) : [], [actor, assemblyId, catalog]);
  useEffect(() => {
    if (!actor) return;
    const assembly = actor.assemblies.find((entry) => entry.id === assemblyId);
    const next = assembly ? Object.keys(catalog.assets[assembly.base]?.animation?.states ?? {})[0] : availableStates.includes('idle') ? 'idle' : availableStates[0];
    if (!availableStates.includes(actorState)) setActorState(next ?? 'idle');
  }, [actor, actorState, assemblyId, availableStates, catalog]);

  const cycleActorState = useCallback(() => {
    if (!availableStates.length) return;
    setActorState((current) => availableStates[(availableStates.indexOf(current) + 1) % availableStates.length]);
  }, [availableStates]);
  const completeActorState = useCallback(({ returnTo, terminal }) => {
    if (returnTo && availableStates.includes(returnTo)) setActorState(returnTo);
    else if (terminal) setPaused(true);
  }, [availableStates]);

  const scenePosition = sceneIndex.findIndex((entry) => entry.id === sceneId);
  const cycleScene = useCallback((offset) => {
    if (!sceneIndex.length) return;
    const next = sceneIndex[(scenePosition + offset + sceneIndex.length) % sceneIndex.length]; loadScene(next.id);
  }, [loadScene, sceneIndex, scenePosition]);
  useEffect(() => {
    clearInterval(sceneTimerRef.current); if (autoScenes && !paused) sceneTimerRef.current = setInterval(() => cycleScene(1), 12000);
    return () => clearInterval(sceneTimerRef.current);
  }, [autoScenes, cycleScene, paused]);

  const coverage = useMemo(() => catalog ? catalogCoverage(catalog) : null, [catalog]);
  const themes = useMemo(() => coverage ? DEMO_THEME_TAGS.filter((tag) => coverage.tags[tag] > 0) : [], [coverage]);
  const filteredAssets = useMemo(() => {
    if (!catalog) return [];
    const query = assetSearch.trim().toLowerCase();
    return Object.entries(catalog.assets).filter(([id, asset]) => assetMatchesTheme(id, asset, themeFilter) && assetMatchesCategory(asset, categoryFilter) && (!query || id.includes(query) || asset.tags?.some((tag) => tag.includes(query)))).slice(0, 120);
  }, [assetSearch, catalog, categoryFilter, themeFilter]);
  useEffect(() => {
    if (!filteredAssets.length) { setSelectedAssetId(''); return; }
    if (!filteredAssets.some(([id]) => id === selectedAssetId)) setSelectedAssetId(filteredAssets[0][0]);
  }, [filteredAssets, selectedAssetId]);
  const selectedAsset = catalog?.assets?.[selectedAssetId];

  const dispatchTouch = useCallback((action, phase) => surfaceRef.current?.dispatch(action, phase, { source: 'touch' }), []);
  const actorEquipment = actor ? equipmentForAssembly(actor, assemblyId) : {};

  if (loading && !catalog) return <main className="game-demo game-demo--loading"><div className="game-demo__loader" role="status">Loading mounted game catalog…</div></main>;
  if (error && !catalog) return <main className="game-demo game-demo--loading"><div className="game-demo__fatal" role="alert"><h1>Game framework unavailable</h1><p>{error.message}</p><button type="button" onClick={() => window.location.reload()}>Retry</button></div></main>;

  return (
    <main className="game-demo">
      <header className="game-demo__header">
        <div><p className="game-demo__eyebrow">Interactive presentation laboratory</p><h1>Game Framework Demo</h1><p>One runtime · {sceneIndex.length} environments · {coverage?.assets ?? 0} reviewed assets</p></div>
        <div className="game-demo__header-actions"><span className={`game-demo__status ${error ? 'is-error' : ''}`}>{error ? error.message : loading ? 'Loading scene…' : 'Runtime ready'}</span>{clear && <button type="button" onClick={clear}>Close</button>}</div>
      </header>

      <section className="game-demo__scene-nav" aria-label="Environment selection">
        <button type="button" onClick={() => cycleScene(-1)} aria-label="Previous environment">←</button>
        <label><span>Environment</span><select value={sceneId} onChange={(event) => loadScene(event.target.value)}>{sceneIndex.map((entry) => <option key={entry.id} value={entry.id}>{titleCase(entry.theme)} · {titleCase(entry.id)}</option>)}</select></label>
        <button type="button" onClick={() => cycleScene(1)} aria-label="Next environment">→</button>
        <Toggle checked={autoScenes} onChange={setAutoScenes}>Cycle every 12s</Toggle>
        <div className="game-demo__scene-pips" aria-hidden="true">{sceneIndex.map((entry) => <span key={entry.id} className={entry.id === sceneId ? 'is-active' : ''} />)}</div>
      </section>

      <div className="game-demo__workspace">
        <section className="game-demo__stage-card">
          <div className="game-demo__stage-toolbar">
            <div><strong>{titleCase(sceneId)}</strong><span>{scene?.style_profile} · {scene?.logical_size?.join('×')} logical px</span></div>
            <div className="game-demo__toggles"><Toggle checked={!paused} onChange={(value) => setPaused(!value)}>Running</Toggle><Toggle checked={animateWorld} onChange={setAnimateWorld}>World motion</Toggle><Toggle checked={showGrid} onChange={setShowGrid}>Grid</Toggle><Toggle checked={reducedMotion} onChange={setReducedMotion}>Reduced motion</Toggle></div>
          </div>
          <div className="game-demo__stage">
            {catalog && scene && <InteractiveSceneSurface ref={surfaceRef} catalog={catalog} scene={scene} actorChoice={actor} actorState={actorState} assemblyId={assemblyId} animateWorld={animateWorld} paused={paused} reducedMotion={reducedMotion} showGrid={showGrid} onInspect={setInspection} onRuntime={setRuntime} onError={setError} onTogglePause={() => setPaused((value) => !value)} onRequestNextState={cycleActorState} onActorStateComplete={completeActorState} />}
            <div className="game-demo__stage-hint">Move near a chest, sign, or mechanism and press A to interact. Click any sprite to inspect it.</div>
          </div>

          <div className="game-demo__controls">
            <div className="game-demo__dpad" aria-label="Directional controls">{PRESENTATION_DPAD.map(({ action, label, glyph }) => <button key={action} type="button" className={`game-demo__dpad-${action.split('.')[1]}`} aria-label={label} onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); dispatchTouch(action, 'press'); }} onPointerUp={() => dispatchTouch(action, 'release')} onPointerCancel={() => dispatchTouch(action, 'release')}>{glyph}</button>)}</div>
            <div className="game-demo__action-pad"><button type="button" className="game-demo__button-b" onPointerDown={() => dispatchTouch('action.secondary', 'press')}>B<small>Next action</small></button><button type="button" className="game-demo__button-a" onPointerDown={() => dispatchTouch('action.primary', 'press')}>A<small>Interact</small></button></div>
            <div className="game-demo__keyboard-help"><kbd>WASD</kbd><span>or arrows to move</span><kbd>Space</kbd><span>interact</span><kbd>Shift</kbd><span>next action</span><kbd>P</kbd><span>pause</span></div>
          </div>
        </section>

        <aside className="game-demo__runtime-panel">
          <section><h2>Playable actor</h2><label>Actor / rig<select value={actor?.id ?? ''} onChange={(event) => { setActorId(event.target.value); setAssemblyId(''); setActorState('idle'); }}>{actors.map((choice) => <option key={choice.id} value={choice.id}>{titleCase(choice.label)}</option>)}</select></label>
            {actor?.assemblies?.length > 0 && <label>Layer assembly<select value={assemblyId} onChange={(event) => setAssemblyId(event.target.value)}><option value="">Base actor</option>{actor.assemblies.map((assembly) => <option key={assembly.id} value={assembly.id}>{titleCase(assembly.id)}</option>)}</select></label>}
            <label>Animation state<select value={actorState} onChange={(event) => setActorState(event.target.value)}>{availableStates.map((state) => <option key={state} value={state}>{titleCase(state)}</option>)}</select></label>
            <div className="game-demo__layer-list"><span>{Object.keys(actorEquipment).length ? `${Object.keys(actorEquipment).length} equipped semantic layers` : 'Base layer only'}</span>{Object.keys(actorEquipment).map((slot) => <code key={slot}>{slot}</code>)}</div>
          </section>
          <section><h2>Runtime telemetry</h2><dl><div><dt>Facing</dt><dd>{runtime?.facing ?? '—'}</dd></div><div><dt>State</dt><dd>{runtime?.state ?? actorState}</dd></div><div><dt>Position</dt><dd>{runtime?.position?.map(Math.round).join(', ') ?? '—'}</dd></div><div><dt>Draws</dt><dd>{runtime?.draws ?? '—'}</dd></div><div><dt>Nearby</dt><dd>{runtime?.nearby ?? 'none'}</dd></div><div><dt>Gamepads</dt><dd>{runtime?.gamepads ?? 0}</dd></div></dl></section>
          <section><h2>Inspector</h2>{inspection ? <><strong>{inspection.asset}</strong><p>{inspection.type === 'interaction' ? `Triggered ${inspection.transition}` : inspection.frame ?? inspection.command?.frame}</p><code>{inspection.command?.provenance ?? inspection.key}</code></> : <p>Click a rendered sprite or interact with an object.</p>}</section>
        </aside>
      </div>

      <section className="game-demo__coverage">
        <div className="game-demo__section-heading"><div><p className="game-demo__eyebrow">Catalog explorer</p><h2>Cross-pack asset coverage</h2></div><div className="game-demo__metrics"><span><strong>{coverage?.actors}</strong> actors</span><span><strong>{coverage?.animated}</strong> state machines</span><span><strong>{coverage?.objects}</strong> transition objects</span><span><strong>{coverage?.rigs}</strong> layered rigs</span></div></div>
        <div className="game-demo__filters"><label>Pack / theme<select value={themeFilter} onChange={(event) => setThemeFilter(event.target.value)}><option value="all">All packs</option>{themes.map((theme) => <option key={theme} value={theme}>{titleCase(theme)} ({coverage.tags[theme]})</option>)}</select></label><label>Kind<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>{CATEGORY_FILTERS.map((category) => <option key={category} value={category}>{titleCase(category)}</option>)}</select></label><label className="game-demo__search">Search<input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value.toLowerCase())} placeholder="skeleton, water, house…" /></label><span>{filteredAssets.length} shown</span></div>
        <div className="game-demo__asset-workspace">
          <div className="game-demo__asset-list" role="listbox" aria-label="Catalog assets">{filteredAssets.map(([id, asset]) => <button key={id} type="button" role="option" aria-selected={id === selectedAssetId} className={id === selectedAssetId ? 'is-selected' : ''} onClick={() => setSelectedAssetId(id)}><strong>{titleCase(id)}</strong><span>{asset.world?.scale_class ?? asset.kind}</span><small>{asset.animation?.mode === 'state-machine' ? `${Object.keys(asset.animation.states ?? {}).length} states` : `${Object.keys(asset.frames ?? {}).length} frames`}</small></button>)}</div>
          <aside className="game-demo__asset-detail">{selectedAsset && <><AssetPreview catalog={catalog} assetId={selectedAssetId} reducedMotion={reducedMotion} /><h3>{selectedAssetId}</h3><p>{selectedAsset.tags?.join(' · ')}</p><dl><div><dt>Density</dt><dd>{selectedAsset.pixel_density}×</dd></div><div><dt>Scale class</dt><dd>{selectedAsset.world?.scale_class}</dd></div><div><dt>Frames</dt><dd>{Object.keys(selectedAsset.frames ?? {}).length}</dd></div><div><dt>States</dt><dd>{Object.keys(selectedAsset.animation?.states ?? {}).length}</dd></div><div><dt>Collision</dt><dd>{selectedAsset.world?.collision}</dd></div></dl></>}</aside>
        </div>
      </section>
    </main>
  );
}
