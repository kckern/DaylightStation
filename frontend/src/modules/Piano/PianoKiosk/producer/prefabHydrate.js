/**
 * prefabHydrate — pure resolvers that turn a hand-authored PREFAB payload
 * (Task 9.1, design §4 "Prefabs") into the SAME runtime shapes the household
 * store produces, so a prefab loads through the identical hydration path:
 *
 *   resolvePrefabStack → { id, kind:'stack', layers, source:'prefab', unresolved }
 *       feeds workspaceReducer LOAD_STACK — mirrors useProducerStore.loadCrateStack
 *   resolvePrefabSong  → { id, draft, source:'prefab', unresolved }
 *       feeds draftReducer HYDRATE — mirrors useProducerStore.loadSong
 *
 * WHY A RESOLVER AT ALL: prefab YAML references library loops by slug/path
 * (design §4: "reference real library loops by slug"), NOT by embedding the
 * ~3.2k-entry index's fat timeline blobs. This module resolves each ref against
 * the LIVE loop index (`lib.loops`) into a `{ kind:'library', entry }` layer
 * source — the canonical entry, always current with enrichment. A ref that
 * doesn't resolve is dropped and reported in `unresolved` (never a crash; a
 * stale prefab degrades to the layers that DO resolve). Because prefabs hold
 * only library refs (no recorded-loop ids into the household API), the store's
 * loop-ref fetch pass is a no-op for them — hence a local pure resolver instead
 * of routing prefab ids through the API loaders.
 *
 * Channel policy mirrors workspaceReducer/draftReducer: grooves are pinned to
 * DRUM_CHANNEL (9); every other role takes the lowest free non-drum channel.
 * LOAD_STACK and toSchedulerInputs both re-validate/repair channels downstream,
 * so this allocation only has to be reasonable, not authoritative.
 *
 * Pure: no React, no DOM, no logging (the hooks/shell own side effects).
 */

const DRUM_CHANNEL = 9;

/** GM program defaults per role (same table as workspaceReducer). */
const DEFAULT_PROGRAM_BY_ROLE = Object.freeze({
  chords: 0, melody: 0, bass: 33, idea: 0, groove: null,
});

/** 0 → 'A', 1 → 'B', … (structural fallback label; payloads normally name). */
function labelFor(n) {
  let s = '';
  let i = n + 1;
  while (i > 0) { i -= 1; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
  return s;
}

/** Resolve a `{ slug, path }` ref against the loop index: path is canonical
 * (slugs are NOT unique across packs), slug the fallback. null when neither
 * matches the index. */
export function resolveEntry(ref, loopIndex) {
  if (!ref || !Array.isArray(loopIndex)) return null;
  if (ref.path) {
    const byPath = loopIndex.find((e) => e.path === ref.path);
    if (byPath) return byPath;
  }
  if (ref.slug) {
    const bySlug = loopIndex.find((e) => e.slug === ref.slug);
    if (bySlug) return bySlug;
  }
  return null;
}

/** A channel allocator: grooves pinned to 9, others lowest free non-drum. */
function makeChannelAllocator(seedChannels = []) {
  const used = new Set(seedChannels.filter((c) => Number.isInteger(c) && c !== DRUM_CHANNEL));
  return (role) => {
    if (role === 'groove') return DRUM_CHANNEL;
    for (let c = 0; c <= 15; c += 1) {
      if (c === DRUM_CHANNEL || used.has(c)) continue;
      used.add(c);
      return c;
    }
    return DRUM_CHANNEL; // 16-layer overflow — repairStackChannels drops it later
  };
}

/** Build a workspace/draft layer from a resolved ref + index entry. */
function buildLayer(ref, entry, channel) {
  const role = ref.role || 'idea';
  return {
    id: entry.path || entry.slug || ref.slug || 'layer',
    source: { kind: 'library', entry },
    role,
    channel,
    gmProgram: role === 'groove'
      ? null
      : (Number.isInteger(ref.gmProgram) ? ref.gmProgram : (DEFAULT_PROGRAM_BY_ROLE[role] ?? 0)),
    gain: Number.isFinite(ref.gain) ? Math.max(0, Math.min(1, ref.gain)) : 1,
    muted: false,
    soloed: false,
    carried: false,
  };
}

/**
 * Resolve a prefab STACK payload into workspace-ready layers.
 * @param {object} payload - { id, title?, layers:[{slug,path,role,gain?,gmProgram?}] }
 * @param {Array} loopIndex - the live loop library index (lib.loops)
 * @returns {{ id:string, kind:'stack', layers:Array, source:'prefab', unresolved:Array }}
 */
export function resolvePrefabStack(payload, loopIndex) {
  const alloc = makeChannelAllocator();
  const layers = [];
  const unresolved = [];
  for (const ref of (payload?.layers || [])) {
    const entry = resolveEntry(ref, loopIndex);
    if (!entry) { unresolved.push(ref.path || ref.slug || null); continue; }
    layers.push(buildLayer(ref, entry, alloc(ref.role || 'idea')));
  }
  return { id: payload?.id, kind: 'stack', layers, source: 'prefab', unresolved };
}

/**
 * Resolve a prefab SONG payload into a HYDRATE-ready draft.
 * Carried layers are declared once under `carried` (keyed by a local ref name)
 * and referenced from sections via `{ carried: <refName> }` — the resolver
 * expands each into a `{ carriedRef: <layerId> }` stack placeholder plus a
 * shared `carriedLayers[layerId]` entry, exactly the draft's continuity shape
 * (design §4.1: a groove/bass persists while harmony changes).
 *
 * @param {object} payload - { id, title?, author?, meta?, carried?, sections, arrangement }
 * @param {Array} loopIndex
 * @returns {{ id:string, draft:object, source:'prefab', unresolved:Array }}
 */
export function resolvePrefabSong(payload, loopIndex) {
  const unresolved = [];

  // ── carried pool: one shared layer per ref name, keyed by its layer id ──────
  const carriedLayers = {};
  const carriedIdByRef = {};
  for (const [refName, ref] of Object.entries(payload?.carried || {})) {
    const entry = resolveEntry(ref, loopIndex);
    if (!entry) { unresolved.push(ref.path || ref.slug || null); continue; }
    const channel = (ref.role || 'idea') === 'groove' ? DRUM_CHANNEL : 0;
    const layer = { ...buildLayer(ref, entry, channel), carried: true };
    carriedLayers[layer.id] = layer;
    carriedIdByRef[refName] = layer.id;
  }
  const carriedNonGrooveChannels = Object.values(carriedLayers)
    .filter((l) => l.role !== 'groove').map((l) => l.channel);

  // ── sections: resolve library refs, expand carried refs to placeholders ─────
  const sections = (payload?.sections || []).map((s, i) => {
    const alloc = makeChannelAllocator(carriedNonGrooveChannels);
    const stack = [];
    for (const ref of (s?.layers || [])) {
      if (ref?.carried != null) {
        const layerId = carriedIdByRef[ref.carried];
        if (layerId) stack.push({ carriedRef: layerId });
        continue;
      }
      const entry = resolveEntry(ref, loopIndex);
      if (!entry) { unresolved.push(ref.path || ref.slug || null); continue; }
      stack.push(buildLayer(ref, entry, alloc(ref.role || 'idea')));
    }
    return {
      id: (typeof s?.id === 'string' && s.id) ? s.id : `sec-${i + 1}`,
      name: (typeof s?.name === 'string' && s.name.trim()) ? s.name.trim() : labelFor(i),
      lengthBars: Number.isFinite(s?.lengthBars) ? s.lengthBars : 1,
      stack,
    };
  });

  const known = new Set(sections.map((s) => s.id));
  const arrangement = (payload?.arrangement || [])
    .map((e) => ({ sectionId: e?.section ?? e?.sectionId, repeats: e?.repeats }))
    .filter((e) => known.has(e.sectionId));

  const meta = {
    title: payload?.title != null ? payload.title : null,
    author: payload?.author != null ? payload.author : null,
    keyShift: Number.isFinite(payload?.meta?.keyShift) ? payload.meta.keyShift : 0,
    bpm: Number.isFinite(payload?.meta?.bpm) ? payload.meta.bpm : 100,
  };

  return {
    id: payload?.id,
    draft: { sections, carriedLayers, arrangement, meta },
    source: 'prefab',
    unresolved,
  };
}

export default { resolveEntry, resolvePrefabStack, resolvePrefabSong };
