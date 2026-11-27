// 2026-11-27: a Scripture search resolved its 20 chapters one after another;
// on a cold data mount that passed the 6 s readalong search budget, so
// "Genesis" answered nothing. They resolve together, in match order.
import { describe, it, expect, vi } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlByPrefix: vi.fn(), loadContainedYaml: vi.fn(), findMediaFileByPrefix: vi.fn(),
  fileExists: vi.fn(() => false), dirExists: vi.fn(() => true), listDirs: vi.fn(() => []),
  listYamlFiles: vi.fn(() => []), listEntries: vi.fn(() => []), getStats: vi.fn(() => null),
}));

const { ReadalongAdapter } = await import("../../../../../__capabilities/content-catalog/server/adapters/providers/readalong/ReadalongAdapter.mjs");

describe('ReadalongAdapter.search resolves matches together', () => {
  it('ten 100 ms chapter reads finish in about one read, in match order, failures skipped', async () => {
    const adapter = new ReadalongAdapter({ dataPath: '/mock/readalong', mediaPath: '/mock/media' });
    const matches = Array.from({ length: 10 }, (_, i) => ({ localId: `scripture/bom/sebom/${i}` }));
    adapter._loadManifest = () => ({ defaults: {} });
    adapter._loadResolver = async () => ({ search: () => matches });
    adapter.getItem = vi.fn((id) => new Promise((resolve, reject) => setTimeout(() => {
      if (id.endsWith('/3')) reject(new Error('unreadable'));
      else resolve({ id: `readalong:${id}`, title: id });
    }, 100)));

    const started = Date.now();
    const { items } = await adapter.search({ text: 'nephi', take: 20 });
    expect(Date.now() - started).toBeLessThan(600);
    expect(items.map((i) => i.title)).toEqual(matches.map((m) => m.localId).filter((id) => !id.endsWith('/3')));
  });
});
