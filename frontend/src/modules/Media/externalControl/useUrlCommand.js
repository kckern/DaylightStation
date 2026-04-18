import { useEffect, useRef } from 'react';
import mediaLog from '../logging/mediaLog.js';

export const URL_TOKEN_KEY = 'media-app.url-command-token';

function tokenFor(search) {
  return `v1:${search}`;
}

function parse(search) {
  if (!search) return null;
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const play = sp.get('play');
  const queue = sp.get('queue');
  const shuffle = sp.get('shuffle') === '1';
  const shader = sp.get('shader');
  const volumeRaw = sp.get('volume');

  const unknownKeys = [];
  for (const k of sp.keys()) {
    if (!['play', 'queue', 'shuffle', 'shader', 'volume'].includes(k)) unknownKeys.push(k);
  }

  // Volume: spec says URL is 0..1 float; snapshot stores 0..100 int.
  let volume;
  if (volumeRaw != null) {
    const n = Number(volumeRaw);
    if (Number.isFinite(n)) {
      volume = n <= 1 ? Math.round(n * 100) : Math.max(0, Math.min(100, Math.round(n)));
    }
  }

  if (!play && !queue && volume == null && shader == null && !shuffle) return null;

  return { play, queue, shuffle, shader, volume, unknownKeys };
}

export function useUrlCommand(controller, searchString = typeof window !== 'undefined' ? window.location.search : '') {
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current || !controller) return;
    const cmd = parse(searchString);
    if (!cmd) return;

    const token = tokenFor(searchString);
    const last = localStorage.getItem(URL_TOKEN_KEY);
    if (last === token) {
      mediaLog.urlCommandIgnored({ reason: 'dedupe', token });
      appliedRef.current = true;
      return;
    }

    for (const k of cmd.unknownKeys) {
      mediaLog.urlCommandIgnored({ reason: 'unknown-key', key: k });
    }

    if (cmd.shuffle) controller.config.setShuffle(true);
    if (cmd.shader != null) controller.config.setShader(cmd.shader);
    if (cmd.volume != null) controller.config.setVolume(cmd.volume);

    if (cmd.play) {
      controller.queue.playNow({ contentId: cmd.play }, { clearRest: true });
      mediaLog.urlCommandProcessed({ param: 'play', value: cmd.play });
    }
    if (cmd.queue) {
      controller.queue.add({ contentId: cmd.queue });
      mediaLog.urlCommandProcessed({ param: 'queue', value: cmd.queue });
    }

    try { localStorage.setItem(URL_TOKEN_KEY, token); } catch { /* ignore */ }
    appliedRef.current = true;
  }, [controller, searchString]);
}

export default useUrlCommand;
