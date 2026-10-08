/**
 * ScreenRegistryService — the household's one list of screens
 * (RQ-HOUSE-06, RQ-HOUSE-08, RQ-AUTO-02).
 *
 * Configured screens come from devices.yml (read-only); browsers register by
 * announcing themselves; people can add, name, place, merge and retire
 * screens. Rules live in #domains/media/screenRegistry.mjs; this service
 * loads/saves the registry, joins live signals (liveness, play ledger,
 * announces) and asks the routine catalog before a rename or retirement of a
 * screen a routine targets.
 *
 * Writes are serialized per household (read-modify-write of one YAML file).
 * An announce from a screen already known only refreshes an in-memory
 * lastSeen and persists it at most every 10 minutes.
 */
import {
  buildScreenView,
  touchScreen,
  renameScreen,
  setScreenRoom,
  setRoomNeighbours,
  roomAdjacencyView,
  addScreen,
  mergeScreens,
  retireScreen,
  restoreScreen,
  unmergeScreen,
  recordSpotFolds,
  resolveScreenId,
  aliasesOf,
  ScreenRegistryError,
  isPlaceholderBrowserName,
} from '#domains/media/screenRegistry.mjs';
import { foldSpot, unfoldSpot } from '#domains/content/services/mediaSpots.mjs';

const PERSIST_SEEN_EVERY_MS = 10 * 60 * 1000;

export class ScreenRegistryService {
  #store;
  #configured;
  #signals;
  #routines;
  #progress;
  #clock;
  #logger;
  /** @type {Map<string, Promise>} */
  #queues = new Map();
  /** @type {Map<string, string>} key `${hid}|${id}` → ISO lastSeen not yet persisted */
  #seen = new Map();

  /**
   * @param {Object} deps
   * @param {import('./ports/IScreenRegistryDatastore.mjs').IScreenRegistryDatastore} deps.store
   * @param {{list: Function}} deps.configuredScreens - devices.yml media screens
   * @param {{read: Function}|null} [deps.signals] - live lastSeen/online per id
   * @param {{targeting: Function}|null} [deps.routines] - RoutineCatalogService
   * @param {{listAllProgress: Function, updateSpots: Function}|null} [deps.progress] - spot folds on merge/unmerge
   */
  constructor({ store, configuredScreens, signals = null, routines = null, progress = null,
    clock = Date, logger = console }) {
    if (!store) throw new TypeError('ScreenRegistryService requires store');
    if (typeof configuredScreens?.list !== 'function') throw new TypeError('ScreenRegistryService requires configuredScreens.list');
    this.#store = store;
    this.#configured = configuredScreens;
    this.#signals = signals;
    this.#routines = routines;
    this.#progress = progress;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** Late wiring: the routine catalog is built after the registry. */
  setRoutineCatalog(routines) {
    this.#routines = routines;
  }

  #iso() {
    return new Date(this.#clock.now()).toISOString();
  }

  #configuredList(householdId) {
    try {
      return this.#configured.list(householdId) || [];
    } catch (error) {
      this.#logger.warn?.('media.screens.configured_read_failed', { error: error.message });
      return [];
    }
  }

  async #signalMap(householdId) {
    const out = {};
    if (this.#signals?.read) {
      try {
        Object.assign(out, (await this.#signals.read({ householdId })) || {});
      } catch (error) {
        this.#logger.warn?.('media.screens.signals_failed', { error: error.message });
      }
    }
    const prefix = `${householdId ?? ''}|`;
    for (const [key, lastSeen] of this.#seen) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      const prev = out[id]?.lastSeen;
      if (!prev || Date.parse(lastSeen) > Date.parse(prev)) out[id] = { ...(out[id] || {}), lastSeen };
    }
    return out;
  }

  /** Serialize writes per household. */
  #write(householdId, fn) {
    const key = householdId ?? '';
    const prev = this.#queues.get(key) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.#queues.set(key, run.catch(() => {}));
    return run;
  }

  async #state(householdId) {
    return this.#store.load(householdId);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** @returns {Promise<{screens:Object[], notSeenLately:Object[], retired:Object[], unnamed:Object[]}>} */
  async list({ householdId } = {}) {
    const [state, signals] = await Promise.all([this.#state(householdId), this.#signalMap(householdId)]);
    return {
      ...buildScreenView({ configured: this.#configuredList(householdId), state, now: this.#clock.now(), signals }),
      roomAdjacency: roomAdjacencyView(state),
    };
  }

  /** Rooms that neighbour each other (PLACE.4a/AC6): `{ room: [neighbouring rooms] }`. */
  async roomAdjacency({ householdId } = {}) {
    return roomAdjacencyView(await this.#state(householdId));
  }

  /** Replace the neighbours of one room; the link is mutual. `[]` clears them. */
  async setRoomNeighbours({ householdId, room, neighbours } = {}) {
    return this.#write(householdId, async () => {
      const result = setRoomNeighbours(await this.#state(householdId), room, neighbours);
      await this.#store.save(result.state, householdId);
      this.#logger.info?.('media.screens.room_neighbours_set', { householdId: householdId ?? null, room, neighbours: neighbours?.length ?? 0 });
      return { roomAdjacency: result.adjacency };
    });
  }

  /** One screen (any list), or null. Follows a merged id to its screen. */
  async get({ householdId, id } = {}) {
    const state = await this.#state(householdId);
    const target = resolveScreenId(state, this.#qualify(id));
    const view = await this.list({ householdId });
    return [...view.screens, ...view.notSeenLately, ...view.retired, ...(view.unnamed || [])].find((s) => s.id === target) || null;
  }

  /** The screen id a (possibly merged) id now belongs to. */
  async resolve(id, householdId) {
    return resolveScreenId(await this.#state(householdId), this.#qualify(id));
  }

  /** The screen's id plus every duplicate merged into it (ledger/spot ids). */
  async aliasesOf(id, householdId) {
    return aliasesOf(await this.#state(householdId), this.#qualify(id));
  }

  /** Human name for any screen id (bare devices.yml keys accepted), or null. */
  async nameOf(id, householdId) {
    if (!id) return null;
    const screen = await this.get({ householdId, id });
    return screen?.name ?? null;
  }

  /** Every screen id → name (for labelling lists in one read). */
  async names(householdId) {
    const view = await this.list({ householdId });
    const out = {};
    for (const screen of [...view.screens, ...view.notSeenLately, ...view.retired, ...(view.unnamed || [])]) {
      out[screen.id] = screen.name;
      for (const alias of screen.aliases) out[alias] = screen.name;
    }
    return out;
  }

  /** Routines whose target is this screen (or a duplicate merged into it). */
  async routinesFor({ householdId, id } = {}) {
    if (!this.#routines?.targeting) return [];
    const ids = await this.aliasesOf(id, householdId);
    const seen = new Map();
    for (const screenId of ids) {
      for (const routine of (await this.#routines.targeting(screenId, householdId)) || []) {
        if (!seen.has(routine.id ?? routine.name)) seen.set(routine.id ?? routine.name, routine);
      }
    }
    return [...seen.values()];
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * A screen reporting in (POST /screens/announce, playback-state relays).
   * @returns {Promise<Object>} the screen view
   */
  async announce({ householdId, id, name = null, room = null, playing = false, previousId = null } = {}) {
    const at = this.#iso();
    const qualified = this.#qualify(id);
    const key = (screenId) => `${householdId ?? ''}|${screenId}`;
    const state = await this.#state(householdId);
    const target = resolveScreenId(state, qualified);
    const entry = state.screens[target];
    const label = isPlaceholderBrowserName(name) ? null : name;
    // A browser nobody named that never played is not a screen yet: every
    // private window or test browser would otherwise become a lasting row.
    if (!entry && target.startsWith('browser:') && !label && !playing) return null;
    const fresh = entry && Number.isFinite(Date.parse(entry.lastSeen))
      && this.#clock.now() - Date.parse(entry.lastSeen) < PERSIST_SEEN_EVERY_MS;
    let resolved = target;
    // Browsers need a name before the fast path; fleet/added screens have one.
    if (fresh && (entry.name || !target.startsWith('browser:')) && !(playing && !entry.playedAt)) {
      this.#seen.set(key(target), at);
    } else {
      resolved = await this.#write(householdId, async () => {
        const current = await this.#state(householdId);
        const { state: next, id: touched, created } = touchScreen(current, qualified, { name: label, room, at, playing },
          { configured: this.#configuredList(householdId) });
        await this.#store.save(next, householdId);
        this.#seen.delete(key(touched));
        if (created) this.#logger.info?.('media.screens.registered', { householdId: householdId ?? null, id: touched, name: next.screens[touched]?.name ?? null });
        return touched;
      });
    }
    if (previousId) await this.#foldPrevious(householdId, previousId, resolved);
    return this.get({ householdId, id: resolved });
  }

  /**
   * The id this browser was known by before (the old `X-Daylight-Device`
   * token): fold it — its spots and last-device marks — into the one it uses
   * now, the same way a confirmed merge does. Only an id no other named
   * screen holds is folded; a repeat is a no-op.
   */
  async #foldPrevious(householdId, previousId, intoId) {
    let from;
    try { from = this.#qualify(previousId); } catch { return; }
    if (!from.startsWith('browser:') || from === intoId) return;
    const state = await this.#state(householdId);
    if (state.aliases?.[from]) return;
    const existing = state.screens[from];
    if (existing?.name && !isPlaceholderBrowserName(existing.name)) return;
    try {
      const outcome = await this.#write(householdId, async () => {
        const current = await this.#state(householdId);
        if (!current.screens[from]) current.screens[from] = { name: null, room: null, firstSeen: null, lastSeen: null };
        const result = mergeScreens(current, from, intoId, { at: this.#iso(), configured: this.#configuredList(householdId) });
        await this.#store.save(result.state, householdId);
        return result;
      });
      const folds = await this.#foldSpots(from, outcome.into);
      if (folds.length) {
        await this.#write(householdId, async () => {
          await this.#store.save(recordSpotFolds(await this.#state(householdId), from, folds), householdId);
        });
      }
      this.#logger.info?.('media.screens.previous_folded', { householdId: householdId ?? null, from, into: outcome.into, movedSpots: folds.length });
    } catch (error) {
      this.#logger.warn?.('media.screens.previous_fold_failed', { from, into: intoId, error: error.message });
    }
  }

  async #confirmRoutines(householdId, id, confirm, action) {
    const routines = await this.routinesFor({ householdId, id });
    if (routines.length && confirm !== true) {
      throw new ScreenRegistryError(`Routines start playback on this screen; confirm to ${action} it`, {
        code: 'ROUTINES_TARGET', details: { id, action, routines },
      });
    }
    return routines;
  }

  /**
   * Rename. Routines follow the id, so they keep working — but a person must
   * see which ones use the screen first (`confirm: true` once shown).
   */
  async rename({ householdId, id, name, onCollision = 'reject', confirm = false } = {}) {
    const qualified = await this.resolve(id, householdId);
    const routines = await this.#confirmRoutines(householdId, qualified, confirm, 'rename');
    return this.#write(householdId, async () => {
      const result = renameScreen(await this.#state(householdId), qualified, name,
        { at: this.#iso(), configured: this.#configuredList(householdId), onCollision });
      await this.#store.save(result.state, householdId);
      this.#logger.info?.('media.screens.renamed', {
        householdId: householdId ?? null, id: qualified, from: result.previousName, to: result.screen?.name, routines: routines.length,
      });
      return { screen: await this.get({ householdId, id: qualified }), routines };
    });
  }

  async setRoom({ householdId, id, room } = {}) {
    const qualified = await this.resolve(id, householdId);
    return this.#write(householdId, async () => {
      const result = setScreenRoom(await this.#state(householdId), qualified, room,
        { configured: this.#configuredList(householdId), at: this.#iso() });
      await this.#store.save(result.state, householdId);
      this.#logger.info?.('media.screens.room_set', { householdId: householdId ?? null, id: qualified, room: room ?? null });
      return { screen: await this.get({ householdId, id: qualified }) };
    });
  }

  async add({ householdId, name, room = null } = {}) {
    return this.#write(householdId, async () => {
      const result = addScreen(await this.#state(householdId), { name, room, at: this.#iso() },
        { configured: this.#configuredList(householdId) });
      await this.#store.save(result.state, householdId);
      this.#logger.info?.('media.screens.added', { householdId: householdId ?? null, id: result.id, name: result.screen?.name });
      return { screen: await this.get({ householdId, id: result.id }) };
    });
  }

  /**
   * Fold a duplicate into its earlier self. Needs `confirm: true` (the
   * routines targeting either screen are listed first). The duplicate's id
   * becomes an alias (plays and started-by follow it) and its spots are folded
   * onto the target by the shared spot rules (mediaSpots.foldSpot) — newest
   * wins the target's key, the other is kept under the alias. Undo: unmerge.
   */
  async merge({ householdId, fromId, intoId, confirm = false } = {}) {
    const from = this.#qualify(fromId);
    const into = await this.resolve(intoId, householdId);
    if (confirm !== true) {
      const routines = [...await this.routinesFor({ householdId, id: from }), ...await this.routinesFor({ householdId, id: into })];
      throw new ScreenRegistryError('Merging folds one screen into another; confirm to merge', {
        code: 'CONFIRM_REQUIRED', details: { action: 'merge', fromId: from, intoId: into, routines },
      });
    }
    const outcome = await this.#write(householdId, async () => {
      const result = mergeScreens(await this.#state(householdId), from, into,
        { at: this.#iso(), configured: this.#configuredList(householdId) });
      await this.#store.save(result.state, householdId);
      return result;
    });
    const folds = await this.#foldSpots(from, outcome.into);
    if (folds.length) {
      await this.#write(householdId, async () => {
        await this.#store.save(recordSpotFolds(await this.#state(householdId), from, folds), householdId);
      });
    }
    this.#logger.info?.('media.screens.merged', { householdId: householdId ?? null, from, into: outcome.into, movedSpots: folds.length });
    return { screen: await this.get({ householdId, id: outcome.into }), movedSpots: folds.length };
  }

  /**
   * Undo a merge: the alias is its own screen again and the spots folded at
   * merge time go back — unless the target has played on them since.
   */
  async unmerge({ householdId, id } = {}) {
    const alias = this.#qualify(id);
    const result = await this.#write(householdId, async () => {
      const undone = unmergeScreen(await this.#state(householdId), alias,
        { at: this.#iso(), configured: this.#configuredList(householdId) });
      await this.#store.save(undone.state, householdId);
      return undone;
    });
    let restored = 0;
    for (const fold of result.was?.spotFolds || []) {
      try {
        const done = await this.#progress?.updateSpots?.(fold.contentId, fold.namespaceId,
          (current) => unfoldSpot(current, alias, result.into, fold));
        if (done) restored += 1;
      } catch (error) {
        this.#logger.warn?.('media.screens.spot_restore_failed', { id: alias, contentId: fold.contentId, error: error.message });
      }
    }
    this.#logger.info?.('media.screens.unmerged', { householdId: householdId ?? null, id: alias, from: result.into, restoredSpots: restored });
    return { screen: await this.get({ householdId, id: alias }), restoredSpots: restored };
  }

  async retire({ householdId, id, confirm = false } = {}) {
    const qualified = await this.resolve(id, householdId);
    const routines = await this.#confirmRoutines(householdId, qualified, confirm, 'retire');
    return this.#write(householdId, async () => {
      const result = retireScreen(await this.#state(householdId), qualified,
        { at: this.#iso(), configured: this.#configuredList(householdId) });
      await this.#store.save(result.state, householdId);
      this.#logger.info?.('media.screens.retired', { householdId: householdId ?? null, id: qualified, routines: routines.length });
      return { screen: await this.get({ householdId, id: qualified }), routines };
    });
  }

  async restore({ householdId, id } = {}) {
    const qualified = await this.resolve(id, householdId);
    return this.#write(householdId, async () => {
      const result = restoreScreen(await this.#state(householdId), qualified, { configured: this.#configuredList(householdId), at: this.#iso() });
      await this.#store.save(result.state, householdId);
      this.#logger.info?.('media.screens.restored', { householdId: householdId ?? null, id: qualified });
      return { screen: await this.get({ householdId, id: qualified }) };
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** Bare devices.yml keys are accepted where a screen id is expected. */
  #qualify(id) {
    if (typeof id !== 'string') return id;
    return id.includes(':') ? id : `fleet:${id}`;
  }

  /**
   * Fold the duplicate's spots record by record. Each fold runs inside the
   * progress store's updateSpots — on the record as stored at that moment —
   * so a play/log write that landed after the listing is neither lost nor
   * overwritten. Returns what was folded (kept for unmerge).
   */
  async #foldSpots(fromId, intoId) {
    if (!this.#progress?.listAllProgress || !this.#progress?.updateSpots) return [];
    const folds = [];
    try {
      for (const { namespaceId, progress } of await this.#progress.listAllProgress()) {
        if (!progress?.spots?.[fromId]) continue;
        let fold = null;
        await this.#progress.updateSpots(progress.contentId, namespaceId, (current) => {
          const next = foldSpot(current, fromId, intoId);
          if (next) fold = { move: next.move, lastPlayed: next.spots[intoId].lastPlayed, lastDevice: current.lastDevice ?? null };
          return next ? { spots: next.spots, lastDevice: next.lastDevice } : null;
        });
        if (fold) folds.push({ namespaceId, contentId: progress.contentId, ...fold });
      }
    } catch (error) {
      this.#logger.warn?.('media.screens.spot_move_failed', { from: fromId, into: intoId, moved: folds.length, error: error.message });
    }
    return folds;
  }
}

export default ScreenRegistryService;
