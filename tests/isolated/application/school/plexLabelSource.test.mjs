import { describe, it, expect } from 'vitest';
import { PlexLabelSource } from '#apps/school/sources/PlexLabelSource.mjs';

// Fixtures shaped like Plex item metadata carrying a `Label` array of {tag}.
// The injected seam (`plexClient.listLabeled(sectionId)`) is the app.mjs wiring's
// job to implement against Plex's section-by-label query; this source only
// transforms the labelled items into School materials.
function labeledItems() {
  return [
    { ratingKey: '100', title: 'The Secrets of Mental Math', type: 'season', thumb: '/api/v1/proxy/plex/t/100', leafCount: 12,
      Label: [{ tag: 'school:on' }, { tag: 'subject:math' }, { tag: 'grade:upper' }] },
    { ratingKey: '200', title: 'Book of Mormon Stories', type: 'album', thumb: '/api/v1/proxy/plex/t/200', leafCount: 40,
      Label: [{ tag: 'school:on' }, { tag: 'subject:scripture' }] },            // no grade → open to all
    { ratingKey: '300', title: 'Not Enrolled Course', type: 'season', leafCount: 24,
      Label: [{ tag: 'subject:math' }, { tag: 'grade:high' }] },                // NO school:on → excluded
    { ratingKey: '400', title: 'Unshelved Doc', type: 'show', leafCount: 6,
      Label: [{ tag: 'school:on' }, { tag: 'grade:lower' }] },                  // school:on but no subject
  ];
}

function sourceWith(items) {
  return new PlexLabelSource({ plexClient: { listLabeled: async () => items }, logger: { warn() {}, error() {} } });
}

describe('PlexLabelSource.listMaterials', () => {
  it('includes only items carrying the school:on label', async () => {
    const materials = await sourceWith(labeledItems()).listMaterials('17');
    expect(materials.map((m) => m.id)).toEqual(['plex:100', 'plex:200', 'plex:400']);
  });

  it('reads subject and min-grade from each item\'s own labels', async () => {
    const [math] = await sourceWith(labeledItems()).listMaterials('17');
    expect(math).toMatchObject({ id: 'plex:100', title: 'The Secrets of Mental Math', subject: 'math', minGrade: 'upper', source: 'plex-label' });
  });

  it('derives medium from Plex type (album → audio, else video)', async () => {
    const materials = await sourceWith(labeledItems()).listMaterials('17');
    expect(materials.find((m) => m.id === 'plex:200').medium).toBe('audio');
    expect(materials.find((m) => m.id === 'plex:100').medium).toBe('video');
  });

  it('leaves subject null when the item has no subject label (frontend routes it to Library)', async () => {
    const materials = await sourceWith(labeledItems()).listMaterials('17');
    expect(materials.find((m) => m.id === 'plex:400').subject).toBeNull();
  });

  it('leaves min-grade null when the item has no grade label (open to all)', async () => {
    const materials = await sourceWith(labeledItems()).listMaterials('17');
    expect(materials.find((m) => m.id === 'plex:200').minGrade).toBeNull();
  });

  it('passes the poster through and carries the unit count', async () => {
    const [math] = await sourceWith(labeledItems()).listMaterials('17');
    expect(math.poster).toBe('/api/v1/proxy/plex/t/100');
    expect(math.unitCount).toBe(12);
  });
});

describe('PlexLabelSource.getMaterial', () => {
  function dispatchSource(itemType) {
    return new PlexLabelSource({
      plexClient: { listLabeled: async () => [], itemType: async () => itemType },
      videoSource: { getMaterial: async (id) => ({ id, source: 'plex-show', medium: 'video', units: [{ id: 'ep1' }] }) },
      audioSource: { getMaterial: async (id) => ({ id, source: 'plex-album', medium: 'audio', units: [{ id: 'trk1' }] }) },
      logger: { warn() {}, error() {} },
    });
  }

  it('expands a season/show via the video source', async () => {
    const m = await dispatchSource('season').getMaterial('plex:100');
    expect(m.units).toEqual([{ id: 'ep1' }]);
  });

  it('expands an album via the audio source', async () => {
    const m = await dispatchSource('album').getMaterial('plex:200');
    expect(m.units).toEqual([{ id: 'trk1' }]);
  });

  it('reports its own source name, not the delegate\'s', async () => {
    const m = await dispatchSource('season').getMaterial('plex:100');
    expect(m.source).toBe('plex-label');
  });
});
