import { createCanvas, loadImage } from 'canvas';

const cache = new Map();
const CACHE_MAX = 300;

export async function resizeStaticImage(image, { width, height }) {
  const key = `${image.identity}|${image.mtimeMs}|${image.size}|${width || ''}|${height || ''}|${image.contentType}`;
  let buffer = cache.get(key);
  if (!buffer) {
    const source = await loadImage(image.buffer);
    const boxWidth = width || Math.round(source.width * ((height || source.height) / source.height));
    const boxHeight = height || Math.round(source.height * ((width || source.width) / source.width));
    const scale = Math.min(boxWidth / source.width, boxHeight / source.height, 1);
    const drawWidth = Math.max(1, Math.round(source.width * scale));
    const drawHeight = Math.max(1, Math.round(source.height * scale));
    const canvas = createCanvas(drawWidth, drawHeight);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, drawWidth, drawHeight);
    buffer = image.contentType === 'image/png'
      ? canvas.toBuffer('image/png')
      : canvas.toBuffer('image/jpeg', { quality: 0.85 });
    cache.set(key, buffer);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return { ...image, buffer, size: buffer.length };
}
