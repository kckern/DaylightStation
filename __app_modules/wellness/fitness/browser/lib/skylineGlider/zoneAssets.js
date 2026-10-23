// Preloads a resolved zone's image files and sprite-sheet frame map. Nothing
// here throws: each file that fails is reported and its slot keeps rendering
// its SVG preset, so a bad export never blocks a flight.

const IMAGE_TIMEOUT_MS = 8000;

function browserImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error('timeout')), IMAGE_TIMEOUT_MS);
    image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('load-failed')); };
    image.src = url;
  });
}

async function browserJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`http-${response.status}`);
  return response.json();
}

/** Every image path the zone references, deduplicated. */
export function zoneImagePaths(zone) {
  const paths = new Set();
  for (const layer of zone?.layers || []) if (layer.kind === 'image' && layer.src) paths.add(layer.src);
  for (const field of ['fill', 'edge', 'ceiling_edge']) if (zone?.terrain?.[field]) paths.add(zone.terrain[field]);
  if (zone?.sprites?.sheet) paths.add(zone.sprites.sheet);
  return [...paths];
}

/**
 * Accepts the TexturePacker / Aseprite JSON "hash" ({ frames: { name: { frame } } })
 * and "array" ({ frames: [{ filename, frame }] }) exports. Names lose their
 * file extension, so `glider-1.png` is addressed as `glider-1`.
 */
export function parseSpriteFrames(json) {
  const raw = json?.frames;
  const entries = Array.isArray(raw)
    ? raw.map((item) => [item?.filename, item?.frame])
    : Object.entries(raw && typeof raw === 'object' ? raw : {}).map(([name, item]) => [name, item?.frame]);
  const frames = {};
  for (const [name, frame] of entries) {
    if (!name || !frame || ![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite)) continue;
    frames[String(name).replace(/\.[a-z0-9]+$/i, '')] = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  }
  return frames;
}

export async function loadZoneAssets(zone, {
  mediaUrl = (path) => path,
  loadImage = browserImage,
  fetchJson = browserJson,
} = {}) {
  const images = new Map();
  const missing = [];
  await Promise.all(zoneImagePaths(zone).map(async (path) => {
    const url = mediaUrl(path);
    try {
      const size = await loadImage(url);
      if (!(size?.width > 0 && size?.height > 0)) throw new Error('empty-image');
      images.set(path, { url, width: size.width, height: size.height });
    } catch (error) {
      missing.push({ src: path, reason: error?.message || 'load-failed' });
    }
  }));
  let frames = null;
  if (zone?.sprites?.frames) {
    try {
      frames = parseSpriteFrames(await fetchJson(mediaUrl(zone.sprites.frames)));
    } catch (error) {
      missing.push({ src: zone.sprites.frames, reason: error?.message || 'load-failed' });
    }
  }
  const sheet = zone?.sprites?.sheet ? images.get(zone.sprites.sheet) || null : null;
  return { images, sheet: sheet && frames ? sheet : null, frames: sheet ? frames : null, missing };
}

export const EMPTY_ZONE_ASSETS = Object.freeze({ images: new Map(), sheet: null, frames: null, missing: [] });
