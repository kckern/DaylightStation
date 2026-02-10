import { normalizeListItem, extractContentId } from '#adapters/content/list/listConfigNormalizer.mjs';

const items = [
  { input: 'media: sfx/intro', label: 'Intro' },
  { input: 'query: dailynews', label: '10 Min News' },
  { label: 'Come Follow Me Supplement', input: 'watchlist: comefollowme2025' },
  { label: 'Crash Course Kids', input: 'plex: 375839' },
  { input: 'freshvideo: teded', label: 'Ted Ed' },
  { input: 'freshvideo: kidnuz', active: false, label: 'KidNuz' },
  { label: 'Doctrine and Covenants', input: 'watchlist: cfmscripture' },
  { label: 'General Conference', input: 'talk: ldsgc' },
  { input: 'app: wrapup', action: 'Open', label: 'Wrap Up' },
];

for (const raw of items) {
  const norm = normalizeListItem(raw);
  const cid = extractContentId(norm);
  const active = raw.active !== false;
  const isOpen = norm.open ? ' [OPEN]' : '';
  console.log(raw.label.padEnd(28), 'active:', String(active).padEnd(5), 'contentId:', (cid || '(empty)').padEnd(30), isOpen);
}
