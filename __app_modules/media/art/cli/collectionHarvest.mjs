import { decode } from 'html-entities';

const text = (value) => decode(String(value ?? '')).trim();
export function extractCollection(html) {
  const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
  const count = html.match(/id=["']ProductCount(?:Desktop)?["'][^>]*>\s*([\d,]+)\s+products/i)?.[1];
  const visibleHandles = [...new Set([...html.matchAll(/href=["'](?:https?:\/\/[^/]+)?\/products\/([^"'?#]+)/g)].map((m) => decode(m[1])))];
  return { url: canonical ? text(canonical) : null, expectedCount: count ? Number(count.replaceAll(',', '')) : null, visibleHandles };
}

function originalUrl(src) {
  const url = new URL(src.startsWith('//') ? `https:${src}` : src);
  if (url.protocol !== 'https:') throw new Error('Artwork downloads require HTTPS');
  for (const key of ['width', 'height', 'crop', 'format', 'pad']) url.searchParams.delete(key);
  return url.href;
}

export function chooseArtworkImage(product) {
  const ranked = [];
  const unframed = (product.variants || []).filter((variant) => /\bprint\s+only\b|\brolled(?:\s+canvas)?\s+(?:in\s+)?tube\b/i.test(variant.title || ''))
    .map((variant) => variant.featured_image).filter((image) => image?.src);
  const explicit = new Set(unframed.map((image) => originalUrl(image.src)));
  for (const image of [...(product.images || []), ...unframed]) {
    if (!image?.src || !(image.width > 0 && image.height > 0)) continue;
    const url = originalUrl(image.src);
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    if (/\d(?:F[A-Z]{1,8}|-LP\d*[A-Z]*|-AB\d*[A-Z]*|-GW)(?=[_.-]|$)/i.test(name) || /framed|mockup|lifestyle|room[-_ ]?scene/i.test(`${name} ${image.alt || ''}`)) continue;
    const strict = /^[a-z]{0,8}\d{3,}(?:orig(?:inal)?)?(?:_[a-f\d-]{8,})?\.(?:jpe?g|png|webp)$/i.test(name);
    const descriptive = /(?:only[-_ ]art|rolled[-_ ]in[-_ ]tube[-_ ]art|original[-_ ]artwork)/i.test(name);
    if (!strict && !descriptive && !explicit.has(url)) continue;
    const rank = explicit.has(url) || /orig/i.test(name) ? 100 : strict ? 60 : 40;
    ranked.push({ ...image, src: url, rank, reason: explicit.has(url) ? 'explicit-unframed-variant' : /orig/i.test(name) ? 'original-file' : strict ? 'unframed-sku' : 'unframed-description' });
  }
  return ranked.sort((a, b) => b.rank - a.rank || (b.width * b.height) - (a.width * a.height))[0] || null;
}

export function artworkIdentity(artist, title) {
  const normalize = (value) => text(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const baseTitle = text(title).replace(/\s+(?:original\s+(?:artwork|painting)|open\s+edition|limited\s+edition)\s*$/i, '');
  return `${normalize(artist)}|${normalize(baseTitle).replace(/^the /, '')}`;
}

export function buildHarvestItems(products, existing, origin) {
  const known = new Map(existing.map((work) => [artworkIdentity(work.artist, work.title), work]));
  const items = products.map((product) => {
    const tags = Array.isArray(product.tags) ? product.tags : String(product.tags || '').split(',');
    const artist = text(tags.find((tag) => /^Artist_/i.test(tag))?.replace(/^Artist_/i, '')) || 'Unknown artist';
    const title = text(product.title).replace(/\s+original\s+(?:artwork|painting)\s*$/i, '');
    const image = chooseArtworkImage(product);
    return { productId: String(product.id), handle: product.handle, artist, title,
      sourceUrl: new URL(`/products/${product.handle}`, origin).href, sourceTags: tags,
      sourceMedium: product.product_type || product.type || null, image,
      identity: artworkIdentity(artist, title), reviewStatus: 'unreviewed',
    };
  });
  const best = new Map();
  for (const item of items) {
    const current = best.get(item.identity);
    const quality = (entry) => entry?.image ? entry.image.rank * 1e10 + entry.image.width * entry.image.height : -1;
    if (!current || quality(item) > quality(current)) best.set(item.identity, item);
  }
  return items.map((item) => {
    const found = known.get(item.identity);
    if (found) return { ...item, status: 'existing', existingDirectory: found.directory };
    const primary = best.get(item.identity);
    if (item !== primary) return { ...item, status: 'duplicate', duplicateOf: primary.productId };
    return { ...item, status: item.image ? 'download' : 'needs-image' };
  });
}
