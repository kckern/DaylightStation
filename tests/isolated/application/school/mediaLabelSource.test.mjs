import { describe, expect, it } from 'vitest';
import { MediaLabelSource } from '#apps/school/sources/MediaLabelSource.mjs';

const items = [
  { id: 'opaque:1', title: 'Math', medium: 'video', childCount: 12, labels: ['school:on', 'subject:math', 'grade:upper'] },
  { id: 'opaque:2', title: 'Stories', medium: 'audio', childCount: 4, labels: ['school:on', 'subject:literature'] },
  { id: 'opaque:3', title: 'Hidden', medium: 'video', labels: ['subject:math'] },
];

describe('MediaLabelSource', () => {
  it('projects curation, shelf, and level labels without provider knowledge', async () => {
    const source = new MediaLabelSource({ mediaCatalog: { listTagged: async () => items } });
    const materials = await source.listMaterials('library');
    expect(materials.map((item) => item.id)).toEqual(['opaque:1', 'opaque:2']);
    expect(materials[0]).toMatchObject({
      source: 'media-label', medium: 'video', subject: 'math', minGrade: 'upper', unitCount: 12,
    });
    expect(materials[1].minGrade).toBeNull();
  });

  it('delegates expansion by neutral medium and restores its own source identity', async () => {
    const mediaCatalog = { getItem: async () => ({ id: 'opaque:2', medium: 'audio' }) };
    const source = new MediaLabelSource({
      mediaCatalog,
      audioSource: { getMaterial: async (id) => ({ id, source: 'elsewhere', units: [{ id: 'track' }] }) },
      videoSource: { getMaterial: async () => { throw new Error('wrong delegate'); } },
    });
    expect(await source.getMaterial('opaque:2')).toMatchObject({ source: 'media-label', units: [{ id: 'track' }] });
  });
});
