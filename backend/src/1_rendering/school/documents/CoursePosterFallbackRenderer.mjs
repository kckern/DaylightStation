import { createCanvas } from 'canvas';
import { createHash } from 'node:crypto';

/** Deterministic 2:3 JPEG used only when a published poster is unexpectedly absent. */
export function renderCoursePosterFallback(courseId = 'course') {
  const digest = createHash('sha256').update(String(courseId)).digest();
  const hue = digest[0] / 255 * 360;
  const canvas = createCanvas(600, 900);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 600, 900);
  gradient.addColorStop(0, `hsl(${hue} 48% 32%)`);
  gradient.addColorStop(1, `hsl(${(hue + 45) % 360} 55% 16%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 600, 900);
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  ctx.fillRect(42, 42, 516, 816);
  ctx.fillStyle = '#fffaf0';
  ctx.font = '700 30px sans-serif';
  ctx.fillText('DAYLIGHT SCHOOL', 72, 110);
  const title = String(courseId).split('/').at(-1).replace(/[-_]+/g, ' ').toUpperCase();
  ctx.font = '700 52px sans-serif';
  const words = title.split(/\s+/);
  let line = ''; let y = 390;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > 460 && line) { ctx.fillText(line, 72, y); line = word; y += 64; }
    else line = next;
  }
  if (line) ctx.fillText(line, 72, y);
  ctx.font = '24px sans-serif';
  ctx.fillText('Cover artwork unavailable', 72, 790);
  return canvas.toBuffer('image/jpeg', { quality: 0.9, progressive: false, chromaSubsampling: false });
}

export default renderCoursePosterFallback;
