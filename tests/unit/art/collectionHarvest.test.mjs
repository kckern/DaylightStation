import { describe, it, expect } from 'vitest';
import { extractCollection, chooseArtworkImage, artworkIdentity, buildHarvestItems } from '../../../__app_modules/media/art/cli/collectionHarvest.mjs';

describe('collection foundation harvest', () => {
  it('recognizes a saved first page as only a partial collection', () => {
    const html = '<link rel="canonical" href="https://example.test/collections/christ"><span id="ProductCountDesktop">823 products</span><a href="/products/a">A</a><a href="/products/a">A</a><a data-next href="?page=2">Next</a>';
    expect(extractCollection(html)).toEqual({ url: 'https://example.test/collections/christ', expectedCount: 823, visibleHandles: ['a'] });
  });
  it('chooses clean artwork instead of a larger framed mockup and removes resize controls', () => {
    const product = { images: [
      { src: 'https://example.test/YK123456FBL.jpg', width: 4000, height: 5000 },
      { src: 'https://example.test/YK123456Orig.jpg?v=5&width=533&crop=center', width: 2000, height: 3000 },
    ] };
    expect(chooseArtworkImage(product).src).toBe('https://example.test/YK123456Orig.jpg?v=5');
  });
  it('does not silently import frames when no clean image is available', () => {
    expect(chooseArtworkImage({ images: [{ src: 'https://example.test/YK123456-LP15MAP.jpg', width: 3000, height: 4000 }] })).toBeNull();
  });
  it('uses explicit print-only variant evidence for legacy or descriptive image names', () => {
    const clean = { id: 42, src: 'https://example.test/LL56CE.jpg', width: 1200, height: 1600 };
    const out = chooseArtworkImage({ images: [
      { id: 41, src: 'https://example.test/LL56FBL.jpg', width: 4000, height: 5000 }, clean,
    ], variants: [{ title: '12 x 16 / Paper / Print Only', featured_image: clean }] });
    expect(out.src).toBe(clean.src); expect(out.reason).toBe('explicit-unframed-variant');
  });
  it('deduplicates an original and a print of the same artwork across sections', () => {
    expect(artworkIdentity('Artist Name', 'The Quiet Light Original Artwork')).toBe(artworkIdentity('Artist Name', 'Quiet Light'));
    const products = [
      { id: 101, handle: 'quiet-light', title: 'Quiet Light', tags: ['Artist_Artist Name'], images: [{ src: 'https://example.test/AN123.jpg', width: 1200, height: 1600 }] },
      { id: 102, handle: 'quiet-light-original', title: 'The Quiet Light Original Artwork', tags: ['Artist_Artist Name'], images: [{ src: 'https://example.test/AN123Orig.jpg', width: 2000, height: 3000 }] },
    ];
    const out = buildHarvestItems(products, [{ artist: 'Artist Name', title: 'Quiet Light', directory: 'bible/existing' }], 'https://example.test');
    expect(out.map((item) => item.status)).toEqual(['existing', 'existing']);
  });
  it('uses artist tags rather than the print publisher and does not bless imported art', () => {
    const out = buildHarvestItems([{ id: 103, handle: 'new-work', title: 'New Work', vendor: 'Print Publisher', tags: ['Artist_Another Artist'], images: [{ src: '//example.test/AA123.jpg', width: 1200, height: 1800 }] }], [], 'https://example.test');
    expect(out[0]).toMatchObject({ artist: 'Another Artist', status: 'download', reviewStatus: 'unreviewed', sourceUrl: 'https://example.test/products/new-work' });
    expect(out[0].image.src).toBe('https://example.test/AA123.jpg');
  });
});
