import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlObservationStore } from '#adapters/persistence/yaml/YamlObservationStore.mjs';
import { createObservationService } from '#apps/nutrition/ObservationService.mjs';
import { ApplyScanToComposition } from '#apps/nutribot/usecases/ApplyScanToComposition.mjs';
import { nutriscanRefusalNotice } from '#apps/nutribot/lib/routeNutribotScan.mjs';

/**
 * Lets one test hand the use case a parse result the grammar cannot currently
 * produce, standing in for a FUTURE fourth kind. Nothing else is stubbed: when
 * `forcedParse.value` is undefined (every other test) the real `parseScan` runs,
 * so these stay integration tests against the real grammar and the real
 * composition surface — the durable one the fridge sheet actually writes to,
 * over a real observation ledger on a temp directory.
 */
const forcedParse = vi.hoisted(() => ({ value: undefined }));
vi.mock('#domains/nutrition/index.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    parseScan: (code) => (forcedParse.value === undefined ? actual.parseScan(code) : forcedParse.value),
  };
});

const CONFIG = {
  densityLevels: [
    { level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2, macros: { fat_pct: 10, carb_pct: 70, protein_pct: 20 } },
    { level: 4, label: 'Mixed', emoji: '🍛', kcal_per_g: 1.4, macros: { fat_pct: 30, carb_pct: 50, protein_pct: 20 } },
  ],
  containers: { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
};

const silent = { info() {}, warn() {}, debug() {}, error() {} };

/**
 * The composition surface as the fridge sheet meets it in production: the scale
 * observation service over a real ledger. The prompt half is stubbed out (no scale
 * signals are published here, so nothing ever posts) — the scan half is entirely real.
 */
function makeSurface() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-scan-'));
  return createObservationService({
    scaleGateway: { subscribe: () => () => {} },
    observationStore: new YamlObservationStore({
      dataService: { user: { resolveDir: (rel, userId) => path.join(dir, userId, rel) } },
      logger: silent,
    }),
    nutribotContainer: { getLogFoodFromScale: () => ({ execute: async () => ({ success: false }) }) },
    userId: 'kckern',
    timezone: 'UTC',
    clock: () => new Date(Date.UTC(2026, 8, 2, 18, 0, 0)),
    scheduler: { setTimeout: () => 1, clearTimeout: () => {} },
    logger: silent,
  });
}

describe('ApplyScanToComposition', () => {
  let store; let apply;

  beforeEach(() => {
    store = makeSurface();
    apply = new ApplyScanToComposition({ store, config: CONFIG });
  });

  it('declines a code the grammar does not claim, so UPC can fall through', () => {
    expect(apply.execute({ scaleId: 'kitchen', code: '012345678905' })).toEqual({ handled: false });
    expect(store.read('kitchen').active).toBe(false);
  });

  it('records a configured density level', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
    expect(r).toMatchObject({ handled: true, kind: 'density', label: 'Mixed' });
    expect(store.read('kitchen').density).toBe(4);
  });

  it('refuses a density that parses but matches no config row', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'dl:999' });
    expect(r).toMatchObject({ handled: true, ok: false, error: 'UNKNOWN_DENSITY_LEVEL' });
    expect(store.read('kitchen').density).toBeNull();
  });

  it('records a configured container', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'ct:350' });
    expect(r).toMatchObject({ handled: true, kind: 'container', label: 'Mug', grams: 350 });
    expect(store.read('kitchen').container).toBe('mug');
  });

  it('refuses an unknown container instead of taring zero', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'ct:777' });
    expect(r).toMatchObject({ handled: true, ok: false, error: 'UNKNOWN_CONTAINER' });
    expect(store.read('kitchen').container).toBeNull();
  });

  it('clears on rs:clear and reports whether anything was live', () => {
    apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
    expect(apply.execute({ scaleId: 'kitchen', code: 'rs:clear' })).toMatchObject({ handled: true, hadState: true });
    expect(apply.execute({ scaleId: 'kitchen', code: 'rs:clear' })).toMatchObject({ handled: true, hadState: false });
  });

  it('still parses the rs:clear verb to kind reset', () => {
    // The verb/kind asymmetry is deliberate and load-bearing (see
    // ScanVocabularyService). Every sheet already printed carries `rs:clear`.
    expect(apply.execute({ scaleId: 'kitchen', code: 'rs:clear' }))
      .toMatchObject({ handled: true, ok: true, kind: 'reset' });
  });

  // ---------------------------------------------------------------------------
  // rs:undo
  // ---------------------------------------------------------------------------

  describe('rs:undo', () => {
    it('takes back the last scan and leaves the ones before it', () => {
      apply.execute({ scaleId: 'kitchen', code: 'ct:350' });
      apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
      const r = apply.execute({ scaleId: 'kitchen', code: 'rs:undo' });
      expect(r).toMatchObject({ handled: true, ok: true, kind: 'undo', undone: true });
      expect(store.read('kitchen')).toMatchObject({ container: 'mug', density: null });
    });

    it('reports undone: false with nothing to take back, and is not a refusal', () => {
      // `ok: false` puts a ⚠️ on the prompt. A no-op undo is not a bad scan, it
      // is a scan that found nothing — the same shape rs:clear uses for `hadState`.
      const r = apply.execute({ scaleId: 'kitchen', code: 'rs:undo' });
      expect(r).toMatchObject({ handled: true, ok: true, kind: 'undo', undone: false });
    });

    it('is one deep across two consecutive scans', () => {
      apply.execute({ scaleId: 'kitchen', code: 'ct:350' });
      apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
      expect(apply.execute({ scaleId: 'kitchen', code: 'rs:undo' })).toMatchObject({ undone: true });
      expect(apply.execute({ scaleId: 'kitchen', code: 'rs:undo' })).toMatchObject({ undone: false });
      expect(store.read('kitchen').container).toBe('mug');
    });

    it('does not take back a scan the use case refused', () => {
      // `ct:777` never reached the store, so there is no step for it to undo.
      apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
      apply.execute({ scaleId: 'kitchen', code: 'ct:777' });
      expect(apply.execute({ scaleId: 'kitchen', code: 'rs:undo' })).toMatchObject({ undone: true });
      expect(store.read('kitchen').active).toBe(false);   // dl:140 was the only step
    });
  });

  // ---------------------------------------------------------------------------
  // rs:done
  // ---------------------------------------------------------------------------

  describe('rs:done', () => {
    it('ends the placement, consuming every slot', () => {
      apply.execute({ scaleId: 'kitchen', code: 'ct:350' });
      apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
      const r = apply.execute({ scaleId: 'kitchen', code: 'rs:done' });
      expect(r).toMatchObject({ handled: true, ok: true, kind: 'done', hadState: true });
      expect(store.read('kitchen')).toMatchObject({ density: null, container: null, active: false });
    });

    it('reports hadState: false when nothing was live, without refusing', () => {
      expect(apply.execute({ scaleId: 'kitchen', code: 'rs:done' }))
        .toMatchObject({ handled: true, ok: true, kind: 'done', hadState: false });
    });

    it('is reported as done, never as reset — the two mean different things', () => {
      // `rs:done` says "process it", `rs:clear` says "forget it". They wipe the
      // same state today; the ack the user reads must not conflate them.
      apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
      expect(apply.execute({ scaleId: 'kitchen', code: 'rs:done' }).kind).toBe('done');
    });

    it('leaves nothing for a following undo to resurrect', () => {
      apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
      apply.execute({ scaleId: 'kitchen', code: 'rs:done' });
      expect(apply.execute({ scaleId: 'kitchen', code: 'rs:undo' })).toMatchObject({ undone: false });
    });

    // Consuming the slots is only the STORE half of "done". The other half —
    // finalising the entry — happens in the bridge, after this returns, and by
    // then there is nothing left to read. Handing back the pre-consumption
    // snapshot is what lets the caller commit against what was actually scanned;
    // without it the "process it now" card wiped the composition and the entry
    // was stranded with no density, which is the failure the card exists to avoid.
    it('hands back the composition as it stood BEFORE the slots were consumed', () => {
      apply.execute({ scaleId: 'kitchen', code: 'ct:350' });
      apply.execute({ scaleId: 'kitchen', code: 'dl:140' });
      const r = apply.execute({ scaleId: 'kitchen', code: 'rs:done' });

      expect(r.snapshot).toMatchObject({
        density: 4, container: 'mug', active: true,
      });
      // ...and the store really is empty afterwards, so the snapshot is the only
      // copy left.
      expect(store.read('kitchen')).toMatchObject({ density: null, container: null, active: false });
    });

    it('reports a null-slotted snapshot when there was nothing live', () => {
      const r = apply.execute({ scaleId: 'kitchen', code: 'rs:done' });
      expect(r.snapshot).toMatchObject({ density: null, container: null, complete: false, active: false });
    });
  });

  // ---------------------------------------------------------------------------
  // An UNWIRED composition surface. The scan router holds a delegating surface that
  // resolves the scale observation service on every call, and that service only exists
  // once the head of household and the bot id resolve. Until then every write would
  // succeed vacuously — so the grammar would claim the code, the branch would resolve a
  // level and a label, and the fridge sheet would ACKNOWLEDGE a scan recorded nowhere.
  // Control verbs are worse: `hadState`/`undone` come back `undefined`, which the ack
  // renders as "nothing to clear" — indistinguishable from the truth.
  // ---------------------------------------------------------------------------

  describe('an unavailable composition surface', () => {
    /** The shape `app.mjs` builds: every method a no-op, `available()` telling the truth. */
    const unwired = () => ({
      available: () => false,
      setWeight: () => {}, setDensity: () => {}, setContainer: () => {},
      endPlacement: () => undefined, clear: () => undefined, undo: () => undefined,
      read: () => null,
    });

    let offline;
    beforeEach(() => {
      offline = new ApplyScanToComposition({ store: unwired(), config: CONFIG, logger: silent });
    });

    it.each([
      ['density', 'dl:140'],
      ['container', 'ct:350'],
      ['reset', 'rs:clear'],
      ['undo', 'rs:undo'],
      ['done', 'rs:done'],
    ])('refuses a %s scan instead of acknowledging one that went nowhere', (kind, code) => {
      expect(offline.execute({ scaleId: 'kitchen', code }))
        .toEqual({ handled: true, ok: false, kind, error: 'SCALE_UNAVAILABLE' });
    });

    // `ok: false` is what puts the ⚠️ on the prompt. The old behaviour answered
    // `ok: true, level: 4, label: 'Mixed'` for a density that reached nothing at all.
    it('never reports a resolved level or label for a scan that reached nothing', () => {
      const r = offline.execute({ scaleId: 'kitchen', code: 'dl:140' });
      expect(r.ok).toBe(false);
      expect(r).not.toHaveProperty('level');
      expect(r).not.toHaveProperty('label');
    });

    // `handled: false` routes the code onward to the product lookup, which would answer a
    // fridge-sheet code with a nonsense food. A refusal is still a claim.
    it('still CLAIMS the code, so it cannot fall through to the UPC path', () => {
      for (const code of ['dl:140', 'ct:350', 'rs:done']) {
        expect(offline.execute({ scaleId: 'kitchen', code }).handled).toBe(true);
      }
    });

    it('leaves a code the grammar does not claim alone, so UPC still runs', () => {
      expect(offline.execute({ scaleId: 'kitchen', code: '012345678905' })).toEqual({ handled: false });
    });

    // The refusal reads on the prompt rather than as a bare code.
    it('renders a reason a person at the fridge can act on', () => {
      const r = offline.execute({ scaleId: 'kitchen', code: 'dl:140' });
      expect(nutriscanRefusalNotice(r)).toBe('the scale is not wired up — nothing recorded');
    });

    // `available()` is optional precisely so every store that owns its own state — and
    // every existing caller — is unaffected by its introduction.
    it('treats a store that does not declare available() as available', () => {
      const { available, ...noPredicate } = unwired();
      expect(available()).toBe(false);   // the fixture really did have one
      const s = new ApplyScanToComposition({ store: noPredicate, config: CONFIG, logger: silent });
      expect(s.execute({ scaleId: 'kitchen', code: 'dl:140' }).ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Regression: the container branch used to be the implicit fall-through, so
  // ANY kind it did not name arrived there and came back as a broken container.
  // ---------------------------------------------------------------------------

  describe('an unrecognised kind', () => {
    afterEach(() => { forcedParse.value = undefined; });

    it('is never reported as a container', () => {
      // A future fifth kind must not be able to masquerade as `ct:` the way
      // `undo` and `done` did between the grammar landing and their handlers.
      forcedParse.value = { kind: 'portion', size: 'half' };
      const r = apply.execute({ scaleId: 'kitchen', code: 'pn:half' });
      expect(r.kind).not.toBe('container');
      expect(r.error).not.toBe('UNKNOWN_CONTAINER');
    });

    it('is refused rather than silently written to the store', () => {
      forcedParse.value = { kind: 'portion', size: 'half' };
      const r = apply.execute({ scaleId: 'kitchen', code: 'pn:half' });
      expect(r).toMatchObject({ handled: true, ok: false, kind: 'portion' });
      expect(store.read('kitchen').active).toBe(false);
    });

    it('stays CLAIMED, so it cannot fall through to the UPC product lookup', () => {
      // `handled: false` is reserved for codes the grammar does not claim; it
      // routes on to a product database, which would answer a fridge-sheet code
      // with a nonsense food. See routeNutribotScan.
      forcedParse.value = { kind: 'portion', size: 'half' };
      expect(apply.execute({ scaleId: 'kitchen', code: 'pn:half' }).handled).toBe(true);
    });
  });
});
