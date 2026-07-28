import { describe, it, expect, vi } from 'vitest';
import { ValidateCatalog } from '#apps/school/usecases/ValidateCatalog.mjs';
import { ICurriculumCatalog } from '#apps/school/ports/ICurriculumCatalog.mjs';

/**
 * A catalog that lives entirely in memory. An application test never touches
 * the filesystem — everything the use case can see arrives through the port.
 */
class FakeCatalog extends ICurriculumCatalog {
  #units; #documents; #manifests; #errors;

  /**
   * `units`/`documents`/`manifests` are raw entities keyed by their own id;
   * `unitEntries` lets a test hand over entries whose raw payload is too broken
   * to name itself.
   */
  constructor({ units = [], documents = [], manifests = [], unitEntries = null, errors = {} } = {}) {
    super();
    const entries = (list) => list.map((raw) => ({ id: raw?.unitId ?? raw?.id ?? 'anon', raw }));
    this.#units = unitEntries ?? entries(units);
    this.#documents = entries(documents);
    this.#manifests = entries(manifests);
    this.#errors = errors;
  }

  async listUnits() { return { items: this.#units, errors: this.#errors.units ?? [] }; }
  async listDocuments() { return { items: this.#documents, errors: this.#errors.documents ?? [] }; }
  async listManifests() { return { items: this.#manifests, errors: this.#errors.manifests ?? [] }; }
  async getUnit(id) { return this.#units.find((e) => e.id === id)?.raw ?? null; }
  async getDocument(id) { return this.#documents.find((e) => e.id === id)?.raw ?? null; }
  async getManifest(id) { return this.#manifests.find((e) => e.id === id)?.raw ?? null; }
}

const aDocument = (over = {}) => ({
  id: 'ws-01', seed: 7, target: ['letter'],
  blocks: [{ type: 'rich_text', md: 'Simplify each fraction.' }],
  ...over,
});

const aManifest = (over = {}) => ({
  id: 'nova-01', locator: 'plex:4242', title: 'Fractions in the Wild',
  series: 'Nova', provenance: { source: 'pbs' },
  ...over,
});

const aUnit = (over = {}) => ({
  unitId: 'math-fractions-01', title: 'Fractions I', subject: 'math',
  document: 'ws-01',
  provenance: { source: 'hand-authored', reviewState: 'approved' },
  ...over,
});

const build = (catalogInput, opts = {}) => new ValidateCatalog({
  catalog: new FakeCatalog(catalogInput), bankIds: ['caps'], ...opts,
});

describe('empty and happy paths', () => {
  it('an empty catalog is ok with zero counts', async () => {
    const result = await build({}).execute();
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      unitErrors: {}, documentErrors: {}, manifestErrors: {}, catalogErrors: [],
      summary: { units: 0, documents: 0, manifests: 0, publishable: 0 },
    });
  });

  it('a coherent catalog validates clean and counts what loaded', async () => {
    const result = await build({
      units: [aUnit(), aUnit({ unitId: 'math-fractions-02', document: undefined, media: 'nova-01' })],
      documents: [aDocument()],
      manifests: [aManifest()],
    }).execute();
    expect(result.ok).toBe(true);
    expect(result.unitErrors).toEqual({});
    expect(result.summary).toEqual({ units: 2, documents: 1, manifests: 1, publishable: 2 });
  });

  it('resolves a bank reference against the injected bank ids', async () => {
    const result = await build({ units: [aUnit({ document: undefined, bank: 'caps' })] }).execute();
    expect(result.ok).toBe(true);
  });

  it('reports a bank reference that is not in the injected set', async () => {
    const result = await build({ units: [aUnit({ document: undefined, bank: 'ghost' })] }).execute();
    expect(result.ok).toBe(false);
    expect(result.unitErrors['math-fractions-01']).toContain("bank 'ghost' not found");
  });

  it('accepts bankIds as a Set as well as an array', async () => {
    const useCase = new ValidateCatalog({
      catalog: new FakeCatalog({ units: [aUnit({ document: undefined, bank: 'caps' })] }),
      bankIds: new Set(['caps']),
    });
    expect((await useCase.execute()).ok).toBe(true);
  });
});

describe('publishability is separate from validity', () => {
  it('a draft unit is valid but not publishable — both facts are visible', async () => {
    const result = await build({
      units: [aUnit({ provenance: { source: 'hand-authored', reviewState: 'draft' } })],
      documents: [aDocument()],
    }).execute();
    expect(result.ok).toBe(true);
    expect(result.unitErrors).toEqual({});
    expect(result.summary).toEqual({ units: 1, documents: 1, manifests: 0, publishable: 0 });
  });

  it('an invalid unit is never counted publishable even when marked approved', async () => {
    const result = await build({ units: [aUnit({ subject: 'astrology' })] }).execute();
    expect(result.ok).toBe(false);
    expect(result.summary.publishable).toBe(0);
  });
});

describe('reference sets are built from what actually validated', () => {
  it('a unit referencing a document that FAILED validation is a dangling reference', async () => {
    const result = await build({
      units: [aUnit({ document: 'ws-01' })],
      documents: [aDocument({ seed: 'not-a-number' })],
    }).execute();

    expect(result.ok).toBe(false);
    expect(result.documentErrors['ws-01']).toBeDefined();
    expect(result.unitErrors['math-fractions-01']).toContain("document 'ws-01' not found");
  });

  it('a unit referencing a manifest that FAILED validation is a dangling reference', async () => {
    const result = await build({
      units: [aUnit({ document: undefined, media: 'nova-01' })],
      // A locator with no durable metadata is unrepairable, so this manifest fails.
      manifests: [aManifest({ series: undefined, aliases: undefined })],
    }).execute();

    expect(result.ok).toBe(false);
    expect(result.manifestErrors['nova-01']).toBeDefined();
    expect(result.unitErrors['math-fractions-01']).toContain("media 'nova-01' not found");
  });

  it('keys errors by the catalog id even when the entity is too broken to name itself', async () => {
    const catalog = new FakeCatalog({ unitEntries: [{ id: 'wreck', raw: 'not a mapping' }] });
    const result = await new ValidateCatalog({ catalog, bankIds: [] }).execute();
    expect(result.unitErrors.wreck).toEqual(['unit must be a mapping']);
  });
});

describe('datastore errors are surfaced, not swallowed', () => {
  it('malformed-file errors from every listing become catalogErrors and fail the gate', async () => {
    const result = await build({
      units: [aUnit({ document: undefined, bank: 'caps' })],
      errors: {
        units: ['units/broken: bad indentation'],
        documents: ['documents/empty: file is empty'],
        manifests: ['manifests/-oops: unsafe id, skipped'],
      },
    }).execute();

    expect(result.ok).toBe(false);
    expect(result.catalogErrors).toEqual([
      'units/broken: bad indentation',
      'documents/empty: file is empty',
      'manifests/-oops: unsafe id, skipped',
    ]);
    // The healthy sibling still validated — one bad file does not blank the catalog.
    expect(result.unitErrors).toEqual({});
    expect(result.summary.units).toBe(1);
  });
});

describe('render probe', () => {
  const probeCatalog = {
    units: [aUnit()],
    documents: [aDocument(), aDocument({ id: 'rcpt-01', target: ['receipt'] })],
  };

  it('is skipped unless asked for', async () => {
    const measureProbe = vi.fn();
    await build(probeCatalog, { measureProbe }).execute();
    expect(measureProbe).not.toHaveBeenCalled();
  });

  it('is skipped silently when no probe is injected', async () => {
    const result = await build(probeCatalog).execute({ renderProbe: true });
    expect(result.ok).toBe(true);
  });

  it('runs only over valid letter-target documents', async () => {
    const measureProbe = vi.fn().mockResolvedValue(undefined);
    const result = await build({
      ...probeCatalog,
      documents: [...probeCatalog.documents, aDocument({ id: 'bad-01', seed: 'nope' })],
    }, { measureProbe }).execute({ renderProbe: true });

    expect(measureProbe.mock.calls.map((c) => c[0].id)).toEqual(['ws-01']);
    expect(result.ok).toBe(false); // still failing on bad-01's own errors
    expect(result.documentErrors['bad-01']).toBeDefined();
  });

  it('a throwing probe fails that document only', async () => {
    const measureProbe = vi.fn((doc) => (
      doc.id === 'ws-01' ? Promise.reject(new Error('unbalanced brace')) : Promise.resolve()
    ));
    const result = await build({
      units: [],
      documents: [aDocument(), aDocument({ id: 'ws-02' })],
    }, { measureProbe }).execute({ renderProbe: true });

    expect(result.ok).toBe(false);
    expect(result.documentErrors['ws-01']).toEqual([expect.stringContaining('unbalanced brace')]);
    expect(result.documentErrors['ws-02']).toBeUndefined();
  });

  it('a probe that reports errors instead of throwing is merged in', async () => {
    const measureProbe = vi.fn().mockReturnValue({ errors: ['page 2 overflows the margin'] });
    const result = await build({ units: [], documents: [aDocument()] }, { measureProbe })
      .execute({ renderProbe: true });
    expect(result.documentErrors['ws-01']).toEqual(['page 2 overflows the margin']);
  });
});

describe('the gate is read-only', () => {
  it('does not mutate the raw entities it was handed', async () => {
    const unit = aUnit();
    const document = aDocument();
    const before = JSON.stringify({ unit, document });
    await build({ units: [unit], documents: [document] }).execute();
    expect(JSON.stringify({ unit, document })).toBe(before);
  });

  it('has no write method on its surface', () => {
    const useCase = build({});
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(useCase));
    expect(methods).toEqual(['constructor', 'execute']);
  });
});
