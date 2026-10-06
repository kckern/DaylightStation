import React from 'react';
import {
  IconApps, IconBook, IconBooks, IconBrandYoutube, IconBroadcast, IconDeviceGamepad2, IconFile,
  IconFolder, IconHeadphones, IconLibrary, IconList, IconMicrophone, IconMovie, IconMusic,
  IconPalette, IconPhoto, IconSearch, IconVideo,
} from '@tabler/icons-react';
import { sourceRootPresentation } from '../search/resultPresentation.js';

// A real icon per content source: the leading mark of a Browse row that has no
// artwork of its own (never a letter tile).
const SOURCE_ICONS = {
  libby: IconBooks, files: IconFolder, plex: IconMovie, 'local-content': IconLibrary,
  list: IconList, query: IconSearch, freshvideo: IconVideo, stream: IconBroadcast,
  youtube: IconBrandYoutube, immich: IconPhoto, abs: IconHeadphones, 'canvas-filesystem': IconPalette,
  singalong: IconMicrophone, readalong: IconBook, app: IconApps, retroarch: IconDeviceGamepad2, art: IconPalette,
};

export function sourceIconComponent(row) {
  const id = String(row?.id ?? row?.itemId ?? '');
  const root = /^([\w-]+):$/.exec(id);
  if (root && SOURCE_ICONS[root[1]]) return SOURCE_ICONS[root[1]];
  if (row?.itemType === 'container') return IconFolder;
  const type = String(row?.type ?? row?.mediaType ?? row?.metadata?.type ?? '').toLowerCase();
  if (/track|audio|album|song|music/.test(type)) return IconMusic;
  if (/video|episode|movie|clip/.test(type)) return IconMovie;
  return IconFile;
}

export function sourceIconFor(row) {
  const Icon = sourceIconComponent(row);
  return <Icon size={22} stroke={1.6} />;
}

/** Two source roots that read the same ("Art" twice) are one choice: keep the first. */
export function dedupeSourceRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const id = String(row?.id ?? row?.itemId ?? '');
    if (!/^[\w-]+:$/.test(id)) return true;
    const key = String(sourceRootPresentation(row).title).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
