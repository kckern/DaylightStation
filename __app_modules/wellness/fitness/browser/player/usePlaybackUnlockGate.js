import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import {
  normalizePlaybackUnlockRules,
  classifyPlaybackUnlock,
  needsLibraryLookup,
  playbackUnlockScope,
} from './playbackUnlock.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'playback-unlock' });
  return _logger;
}

const plexIdOf = (item) => {
  if (item?.plex) return String(item.plex);
  const cid = item?.contentId || item?.id;
  return typeof cid === 'string' && cid.startsWith('plex:') ? cid.slice(5) : null;
};

/**
 * Hold playback of a gated item (playbackUnlock.js) until an authorized
 * fingerprint is scanned. Fails closed: while the library is being looked up,
 * or if the lookup fails, the item is held and a scan is asked for.
 *
 * Grants are remembered per show for the life of the player, so autoplaying
 * the next episode of an unlocked show does not prompt again.
 *
 * @returns {{ blocked: boolean, promptOpen: boolean, promptTimeoutMs: number|null, cancel: () => void }}
 */
export function usePlaybackUnlockGate({
  currentItem, active, rules: rawRules, preGranted = false, registerUnlock, clearUnlock, onCancel, fetchInfo,
}) {
  const rules = useMemo(() => normalizePlaybackUnlockRules(rawRules), [rawRules]);
  const scope = playbackUnlockScope(currentItem, rules.scope);
  const itemKey = currentItem ? String(currentItem.contentId || currentItem.id) : null;

  const grantedRef = useRef(new Set());
  const [, bump] = useState(0);
  // Classification per item key: { required, reason } once known.
  const [verdicts, setVerdicts] = useState({});
  const [promptOpen, setPromptOpen] = useState(false);
  const promptForRef = useRef(null);
  const itemKeyRef = useRef(itemKey);
  itemKeyRef.current = itemKey;

  const enabled = Boolean(active && rules.lock && currentItem && (rules.labels.size || rules.libraries.size));

  const syncVerdict = useMemo(() => {
    if (!enabled) return { required: false, reason: null };
    if (needsLibraryLookup(currentItem, rules)) return null; // async
    return classifyPlaybackUnlock(currentItem, rules);
  }, [enabled, currentItem, rules]);
  const verdict = syncVerdict ?? verdicts[itemKey] ?? null;

  // Library lookup for items whose labels did not decide it.
  useEffect(() => {
    if (!enabled || syncVerdict || verdicts[itemKey]) return;
    const key = itemKey;
    const plexId = plexIdOf(currentItem);
    const settle = (v) => setVerdicts((prev) => ({ ...prev, [key]: v }));
    if (!plexId || typeof fetchInfo !== 'function') {
      settle(classifyPlaybackUnlock(currentItem, rules));
      return;
    }
    let cancelled = false;
    Promise.resolve(fetchInfo(plexId)).then((info) => {
      if (cancelled) return;
      settle(classifyPlaybackUnlock({
        labels: [...(currentItem.labels || []), ...(info?.labels || [])],
        librarySectionTitle: info?.librarySectionTitle,
      }, rules));
    }).catch((err) => {
      if (cancelled) return;
      logger().warn('playback_unlock.lookup_failed', { contentId: key, error: err?.message || String(err) });
      settle({ required: true, reason: 'lookup-failed' });
    });
    return () => { cancelled = true; };
  }, [enabled, syncVerdict, verdicts, itemKey, currentItem, rules, fetchInfo]);

  const granted = preGranted || (scope != null && grantedRef.current.has(scope));
  const blocked = enabled && !granted && (verdict == null || verdict.required);
  const needsScan = enabled && !granted && verdict?.required === true;

  useEffect(() => {
    if (!needsScan || promptForRef.current === itemKey) return;
    promptForRef.current = itemKey;
    const reqKey = itemKey;
    const reqScope = scope;
    setPromptOpen(true);
    logger().info('playback_unlock.required', { contentId: reqKey, scope: reqScope, reason: verdict.reason, title: currentItem?.title || null });
    registerUnlock(rules.lock).then((result) => {
      if (itemKeyRef.current !== reqKey) return; // item changed mid-scan
      if (result?.matched) {
        grantedRef.current.add(reqScope);
        logger().info('playback_unlock.granted', { contentId: reqKey, scope: reqScope, userId: result.userId || null });
        setPromptOpen(false);
        clearUnlock?.();
        bump((n) => n + 1);
      } else {
        // Wrong finger: the prompt shows the denied state; the item stays held.
        logger().info('playback_unlock.denied', { contentId: reqKey, reason: result?.reason || null });
      }
    });
  }, [needsScan, itemKey, scope, verdict, currentItem, rules.lock, registerUnlock, clearUnlock]);

  useEffect(() => {
    if (!needsScan && promptOpen && granted) setPromptOpen(false);
  }, [needsScan, promptOpen, granted]);

  const cancel = useCallback(() => {
    logger().info('playback_unlock.cancelled', { contentId: itemKeyRef.current });
    setPromptOpen(false);
    clearUnlock?.();
    onCancel?.();
  }, [clearUnlock, onCancel]);

  return { blocked, promptOpen, promptTimeoutMs: rules.promptTimeoutMs, cancel };
}

export default usePlaybackUnlockGate;
