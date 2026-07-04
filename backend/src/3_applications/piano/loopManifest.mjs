// Walk the five brick folders under media/midi, parse each MusicXML brick's
// metadata + notes, bake a root-0 harmonic timeline (bricks are canonical-C),
// and cache the result by folder mtime. Consumed by the /loop-manifest endpoint
// and, downstream, by useLoopLibrary → libraryRanking (grid-based gate).

import path from 'path';
import { listFiles, readFile, getStats } from '#system/utils/FileIO.mjs';
import { musicXmlToNotes, readBrickMeta } from '../../../../shared/music/musicXmlToNotes.mjs';
import { harmonicTimeline } from '../../../../shared/music/harmonicTimeline.mjs';

const TYPE_FOLDERS = ['chords', 'basslines', 'melodies', 'ideas', 'percussion'];
const SKIP_HARMONY = new Set(['groove', 'percussion']);

const csv = (s) => (typeof s === 'string' && s.trim()
  ? s.split(',').map((x) => x.trim()).filter(Boolean)
  : []);

/** Build one manifest entry from a brick's relative path + raw XML. Pure. */
export function buildBrickEntry(relPath, xml) {
  const meta = readBrickMeta(xml);
  const type = meta.type || 'idea';
  const entry = {
    path: relPath,
    slug: meta['source-slug'] || meta['canonical-name'] || relPath,
    type,
    title: meta.title || '',
    genre: csv(meta.genre),
    emotion: csv(meta.emotion),
    tags: csv(meta.tags),
    quality: meta.quality || '',
    artist: meta.artist || '',
    bpm: meta.bpm ? Number(meta.bpm) : null,
    reverb: meta.reverb || '',
    roman: meta['derived-signature'] ? meta['derived-signature'].split('-').filter(Boolean) : [],
  };
  if (SKIP_HARMONY.has(type)) {
    entry.feel = meta['canonical-name'] || ''; // grooves have no harmonic content
    return entry;
  }
  try {
    const { ppq, notes, timeSig } = musicXmlToNotes(xml);
    if (!notes.length) {
      entry.needsReview = true;
      entry.needsReviewReason = 'parse-fail';
      return entry;
    }
    const tl = harmonicTimeline(notes, ppq, { rootOverride: 0, timeSig });
    entry.timeline = tl.slots;
    entry.timelineRoot = tl.root; // always 0 (canonical C)
    entry.specificity = tl.specificity;
  } catch (err) {
    entry.needsReview = true;
    entry.needsReviewReason = `engine-throw: ${err.message}`;
  }
  return entry;
}

/** Walk the five type folders under midiDir → array of manifest entries. */
export function buildManifest(midiDir) {
  const bricks = [];
  for (const folder of TYPE_FOLDERS) {
    const dir = path.join(midiDir, folder);
    for (const file of listFiles(dir)) {
      if (!file.endsWith('.musicxml')) continue;
      const xml = readFile(path.join(dir, file));
      if (xml == null) continue;
      const relPath = `${folder}/${file}`;
      try {
        bricks.push(buildBrickEntry(relPath, xml));
      } catch (err) {
        bricks.push({ path: relPath, type: folder, needsReview: true, needsReviewReason: `build-fail: ${err.message}` });
      }
    }
  }
  return bricks;
}

/** Folder-mtime signature — invalidates the cache when bricks are (re)generated. */
export function manifestSignature(midiDir) {
  return TYPE_FOLDERS.map((f) => {
    const st = getStats(path.join(midiDir, f));
    return `${f}:${st ? st.mtimeMs : 0}`;
  }).join('|');
}

let _cache = null; // { sig, bricks }

/** mtime-cached manifest. Pass { refresh: true } to force a rebuild. */
export function getManifest(midiDir, { refresh = false } = {}) {
  const sig = manifestSignature(midiDir);
  if (!refresh && _cache && _cache.sig === sig) return _cache.bricks;
  const bricks = buildManifest(midiDir);
  _cache = { sig, bricks };
  return bricks;
}

export default { buildBrickEntry, buildManifest, getManifest, manifestSignature };
