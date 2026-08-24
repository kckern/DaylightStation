#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { createCanvas, loadImage } from 'canvas';

const [contentRoot, mediaRoot, pokemonBackground, scriptureBackground] = process.argv.slice(2);
if (![contentRoot, mediaRoot, pokemonBackground, scriptureBackground].every(Boolean)) {
  throw new Error('usage: build-course-posters.mjs <content-school> <media-school> <pokemon-bg> <scripture-bg>');
}

const WIDTH = 1200; const HEIGHT = 1800;
const fallbackByCourse = new Map([
  ['pokemon-identification', pokemonBackground],
  ['come-follow-me-ot-2026', scriptureBackground],
]);

async function courseIndexes(root) {
  const out = [];
  for (const subject of await fs.readdir(root, { withFileTypes: true })) {
    if (!subject.isDirectory() || subject.name.startsWith('_')) continue;
    const shelf = path.join(root, subject.name);
    for (const course of await fs.readdir(shelf, { withFileTypes: true })) {
      if (!course.isDirectory()) continue;
      for (const filename of ['_index.yml', 'index.yml', 'course.yml']) {
        const file = path.join(shelf, course.name, filename);
        try {
          const text = await fs.readFile(file, 'utf8'); const raw = yaml.load(text);
          if (raw?.schema === 'school.course/v2') out.push({ file, dir: path.dirname(file), subject: subject.name, raw, text });
          break;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  return out;
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/); const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line); return lines;
}

async function brandedPoster(background, title, subject) {
  const source = await loadImage(background); const canvas = createCanvas(WIDTH, HEIGHT); const ctx = canvas.getContext('2d');
  const scale = Math.max(WIDTH / source.width, HEIGHT / source.height);
  const w = source.width * scale; const h = source.height * scale;
  ctx.drawImage(source, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
  const gradient = ctx.createLinearGradient(0, 0, 0, 610); gradient.addColorStop(0, 'rgba(10,24,45,.93)'); gradient.addColorStop(1, 'rgba(10,24,45,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, WIDTH, 650);
  ctx.fillStyle = '#fff8e7'; ctx.font = '700 88px sans-serif'; ctx.textAlign = 'center';
  const lines = wrap(ctx, title, 1030); lines.forEach((line, index) => ctx.fillText(line, WIDTH / 2, 150 + index * 100));
  ctx.font = '600 30px sans-serif'; ctx.letterSpacing = '5px'; ctx.fillText(`${subject.toUpperCase()} · DAYLIGHT SCHOOL`, WIDTH / 2, 1650);
  return canvas.toBuffer('image/jpeg', { quality: 0.94, progressive: false, chromaSubsampling: false });
}

function addPosterField(text) {
  if (/^["']?poster["']?\s*:/m.test(text)) return text;
  if (/^"schema"\s*:/m.test(text)) return text.replace(/^("schema"\s*:\s*[^\n]+\n)/m, '$1"poster": "poster.jpg"\n');
  return text.replace(/^(schema\s*:\s*[^\n]+\n)/m, '$1poster: poster.jpg\n');
}

const courses = await courseIndexes(contentRoot);
for (const course of courses) {
  const mediaPoster = path.join(mediaRoot, course.subject, course.raw.work, 'poster.jpg');
  let bytes;
  try { bytes = await fs.readFile(mediaPoster); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const background = fallbackByCourse.get(course.raw.work);
    if (!background) throw new Error(`no source poster or fallback for ${course.subject}/${course.raw.work}`);
    bytes = await brandedPoster(background, course.raw.title, course.subject);
  }
  await fs.writeFile(path.join(course.dir, 'poster.jpg'), bytes);
  const updated = addPosterField(course.text);
  if (updated === course.text && course.raw.poster !== 'poster.jpg') throw new Error(`could not insert poster field in ${course.file}`);
  if (updated !== course.text) await fs.writeFile(course.file, updated, 'utf8');
  process.stdout.write(`${course.subject}/${course.raw.work}\n`);
}
if (courses.length !== 15) throw new Error(`expected 15 published courses, found ${courses.length}`);
