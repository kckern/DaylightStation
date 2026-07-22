import { describe, it, expect, beforeEach } from 'vitest';
import { GetMaterialCatalog } from '#apps/school/GetMaterialCatalog.mjs';

let logger, errors, warns;

beforeEach(() => {
  errors = [];
  warns = [];
  logger = {
    error: (event, data) => errors.push({ event, data }),
    warn: (event, data) => warns.push({ event, data }),
    info: () => {},
  };
});

function material(id, extra = {}) {
  return { id, title: `Title ${id}`, poster: null, durationMs: null, unitCount: 3, ...extra };
}

describe('GetMaterialCatalog.execute', () => {
  it('aggregates materials across configured sources, stamping category via resolveCategory', async () => {
    const sources = {
      'plex-album': { listMaterials: async (root) => [material(`plex:${root}-a1`)] },
      'plex-show': { listMaterials: async (root) => [material(`plex:${root}-s1`)] },
    };
    const config = {
      sources: [
        { label: 'Shakespeare Tales', source: 'plex-album', root: '619778', medium: 'audio', category: 'course' },
        { label: 'Art Lessons', source: 'plex-show', root: '685094', medium: 'video', category: 'course' },
      ],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    const catalog = new GetMaterialCatalog({ sources, config, logger });

    const result = await catalog.execute();

    expect(result.materials).toHaveLength(2);
    expect(result.materials.every((m) => m.category === 'course')).toBe(true);
    expect(result.materials.find((m) => m.id === 'plex:619778-a1').medium).toBe('audio');
    expect(result.materials.find((m) => m.id === 'plex:685094-s1').medium).toBe('video');
  });

  it('sections only include categories present among configured sources, in fixed order course, reference, listening', async () => {
    const sources = {
      'plex-album': { listMaterials: async () => [material('plex:a1')] },
    };
    const config = {
      sources: [
        { label: 'Freestyle Listening', source: 'plex-album', root: '1', medium: 'audio', category: 'listening' },
      ],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    const catalog = new GetMaterialCatalog({ sources, config, logger });

    const { sections } = await catalog.execute();

    expect(sections).toEqual([{ category: 'listening', label: 'Listening' }]);
  });

  it('emits all three sections in fixed order+labels when all three categories are configured', async () => {
    const sources = {
      'plex-album': { listMaterials: async (root) => [material(`plex:${root}`)] },
    };
    const config = {
      sources: [
        { label: 'Listening src', source: 'plex-album', root: 'L', medium: 'audio', category: 'listening' },
        { label: 'Course src', source: 'plex-album', root: 'C', medium: 'audio', category: 'course' },
        { label: 'Reference src', source: 'plex-album', root: 'R', medium: 'audio', category: 'reference' },
      ],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    const catalog = new GetMaterialCatalog({ sources, config, logger });

    const { sections } = await catalog.execute();

    expect(sections).toEqual([
      { category: 'course', label: 'Courses' },
      { category: 'reference', label: 'Reference' },
      { category: 'listening', label: 'Listening' },
    ]);
  });

  it('an unrecognised category falls back to reference and warns, naming the source', async () => {
    const sources = {
      'plex-album': { listMaterials: async () => [material('plex:typo1')] },
    };
    const config = {
      sources: [
        { label: 'Typo Source', source: 'plex-album', root: '1', medium: 'audio', category: 'coures' },
      ],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    const catalog = new GetMaterialCatalog({ sources, config, logger });

    const { sections, materials } = await catalog.execute();

    expect(materials[0].category).toBe('reference');
    expect(sections).toEqual([{ category: 'reference', label: 'Reference' }]);
    expect(warns).toHaveLength(1);
    expect(warns[0].event).toBe('school.materials.category-unknown');
    expect(warns[0].data.source).toBe('Typo Source');
  });

  it('a source whose adapter throws is skipped, logs school.materials.source-failed, others still return', async () => {
    const sources = {
      'plex-album': {
        listMaterials: async (root) => {
          if (root === 'broken') throw new Error('plex is down');
          return [material(`plex:${root}`)];
        },
      },
    };
    const config = {
      sources: [
        { label: 'Broken Source', source: 'plex-album', root: 'broken', medium: 'audio', category: 'course' },
        { label: 'Good Source', source: 'plex-album', root: 'good', medium: 'audio', category: 'course' },
      ],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    const catalog = new GetMaterialCatalog({ sources, config, logger });

    const result = await catalog.execute();

    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].id).toBe('plex:good');
    expect(errors).toHaveLength(1);
    expect(errors[0].event).toBe('school.materials.source-failed');
    expect(errors[0].data.source).toBe('Broken Source');
  });

  it('caches listMaterials per root for 60s; a second execute within the window does not re-call it', async () => {
    let calls = 0;
    const sources = {
      'plex-album': { listMaterials: async () => { calls += 1; return [material('plex:a1')]; } },
    };
    const config = {
      sources: [{ label: 'Src', source: 'plex-album', root: '1', medium: 'audio', category: 'course' }],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    let clock = 0;
    const catalog = new GetMaterialCatalog({ sources, config, logger, now: () => clock });

    await catalog.execute();
    expect(calls).toBe(1);

    clock = 59_000; // 59s later, still within TTL
    await catalog.execute();
    expect(calls).toBe(1);

    clock = 61_000; // 61s later, past TTL
    await catalog.execute();
    expect(calls).toBe(2);
  });
});

describe('GetMaterialCatalog.findMaterial', () => {
  it('finds a material by id by walking configured roots (cached listMaterials)', async () => {
    const sources = {
      'plex-album': { listMaterials: async (root) => [material(`plex:${root}-1`)] },
    };
    const config = {
      sources: [
        { label: 'Shakespeare Tales', source: 'plex-album', root: '619778', medium: 'audio', category: 'course' },
      ],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    const catalog = new GetMaterialCatalog({ sources, config, logger });

    const found = await catalog.findMaterial('plex:619778-1');

    expect(found).not.toBeNull();
    expect(found.material.id).toBe('plex:619778-1');
    expect(found.material.category).toBe('course');
    expect(found.entry.label).toBe('Shakespeare Tales');
    expect(found.entry.source).toBe('plex-album');
  });

  it('returns null for an unknown materialId', async () => {
    const sources = {
      'plex-album': { listMaterials: async () => [material('plex:a1')] },
    };
    const config = {
      sources: [{ label: 'Src', source: 'plex-album', root: '1', medium: 'audio', category: 'course' }],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    const catalog = new GetMaterialCatalog({ sources, config, logger });

    expect(await catalog.findMaterial('plex:nope')).toBeNull();
  });

  it('reuses the same 60s cache as execute() (no extra listMaterials calls)', async () => {
    let calls = 0;
    const sources = {
      'plex-album': { listMaterials: async () => { calls += 1; return [material('plex:a1')]; } },
    };
    const config = {
      sources: [{ label: 'Src', source: 'plex-album', root: '1', medium: 'audio', category: 'course' }],
      completion_threshold_percent: 90,
      quiz_pass_percent: 80,
    };
    const catalog = new GetMaterialCatalog({ sources, config, logger, now: () => 0 });

    await catalog.execute();
    await catalog.findMaterial('plex:a1');
    expect(calls).toBe(1);
  });
});
