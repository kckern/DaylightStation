// useAutoResolve.js — row-level auto-resolve for freeform content values.
// Ported from the inline row combobox's commitFreeformText (ListsItemRow.jsx,
// Phase 0 behavior): when a committed value is freeform text (not a content
// id), search the backend in the background and — only if the committed value
// is still that exact text — replace it with the top hit, toast, and seed the
// content-info cache. Port, not a redesign: timeout, staleness guard, and log
// event names (`search.auto_resolve.*`) are unchanged.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getChildLogger } from '../../../../lib/logging/singleton.js';
import { showUndoToast } from '../../shared/feedback.js';

const AUTO_RESOLVE_TIMEOUT_MS = 15000;
// Same gate the twin used: text that already looks like `source:id`
// (or legacy `source: id`) is an intentional id — never auto-resolve it.
const CONTENT_ID_RE = /^[^:]+:\s*.+$/;

/**
 * useAutoResolve — background freeform → content-id resolution for a row.
 *
 * @param {object} args
 * @param {string} args.value - the row's committed value (staleness guard:
 *   a resolve result is dropped unless `value` still equals the freeform text)
 * @param {(id: string, item?: object) => void} args.onChange - called with the
 *   resolved content id when the guard passes
 * @param {(id: string, info: object) => void} [args.setContentInfo] - shared
 *   content-info cache writer (ListsContext)
 * @param {(id: string) => Promise<object|null>} [args.fetchMetadata] - metadata
 *   fetcher used to seed the cache after a successful resolve (injected to
 *   avoid a module cycle with ListsItemRow's fetchContentMetadata)
 * @returns {{ maybeResolve: (freeformText: string, trigger?: string) => boolean,
 *             cancel: () => void }}
 *   maybeResolve returns true when a background resolve was started
 *   (non-id-like text), false otherwise. cancel aborts any in-flight resolve
 *   (call it when the user re-enters edit mode, as the twin did).
 */
export function useAutoResolve({ value, onChange, setContentInfo, fetchMetadata } = {}) {
  const log = useMemo(
    () => getChildLogger({ component: 'useAutoResolve', app: 'admin', sessionLog: true }),
    []
  );

  // Latest-prop refs so the async continuation never reads a stale closure.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const setContentInfoRef = useRef(setContentInfo);
  setContentInfoRef.current = setContentInfo;
  const fetchMetadataRef = useRef(fetchMetadata);
  fetchMetadataRef.current = fetchMetadata;

  // {query, controller, startedAt} of the in-flight resolve, or null.
  const autoResolveRef = useRef(null);

  const cancel = useCallback(() => {
    if (autoResolveRef.current) {
      autoResolveRef.current.controller.abort();
      autoResolveRef.current = null;
    }
  }, []);

  // Abort on unmount (twin parity: cleanup effect aborted autoResolveRef).
  useEffect(() => cancel, [cancel]);

  const maybeResolve = useCallback((freeformText, trigger = 'commit') => {
    if (!freeformText || CONTENT_ID_RE.test(freeformText)) return false;

    cancel(); // one resolve at a time; a newer commit supersedes the old one
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      log.warn('search.auto_resolve.timeout', { query: freeformText, timeoutMs: AUTO_RESOLVE_TIMEOUT_MS });
      controller.abort();
    }, AUTO_RESOLVE_TIMEOUT_MS);
    const entry = { query: freeformText, controller, startedAt: Date.now() };
    autoResolveRef.current = entry;
    log.info('search.auto_resolve.start', { query: freeformText, trigger, timeoutMs: AUTO_RESOLVE_TIMEOUT_MS });

    fetch(
      `/api/v1/content/query/search?text=${encodeURIComponent(freeformText)}&take=1&tier=1`,
      { signal: controller.signal }
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // A newer resolve (or cancel) supersedes this continuation. Identity
        // check (not just query text) so an aborted twin of the same query
        // can never race the live one.
        if (autoResolveRef.current !== entry) return;
        const items = data?.items || [];
        if (items.length > 0 && valueRef.current === freeformText) {
          // Only replace if the committed value is still the freeform text —
          // never clobber a newer manual edit (audit I2).
          const resolved = items[0].id || `${items[0].source}:${items[0].localId}`;
          log.info('search.auto_resolve.success', {
            query: freeformText,
            resolvedTo: resolved,
            title: items[0].title,
            durationMs: Date.now() - entry.startedAt,
          });
          onChangeRef.current?.(resolved, items[0]);
          showUndoToast({
            id: `auto-resolve-${resolved}`,
            title: 'Auto-resolved',
            message: `“${freeformText}” → ${items[0].title}`,
            onUndo: () => {
              log.info('search.auto_resolve.undone', { restoredTo: freeformText, from: resolved });
              onChangeRef.current?.(freeformText);
            },
          });
          // Eagerly populate the content cache so the row doesn't stay in
          // its loading state.
          const fetchMeta = fetchMetadataRef.current;
          if (fetchMeta) {
            fetchMeta(resolved).then((info) => {
              if (info) setContentInfoRef.current?.(resolved, info);
            });
          }
        } else if (items.length > 0) {
          log.info('search.auto_resolve.skipped_stale_value', { query: freeformText, currentValue: valueRef.current });
        } else {
          log.info('search.auto_resolve.no_results', { query: freeformText });
        }
        autoResolveRef.current = null;
      })
      .catch(() => {
        if (autoResolveRef.current === entry) autoResolveRef.current = null;
      })
      .finally(() => clearTimeout(timeout));

    return true;
  }, [cancel, log]);

  return { maybeResolve, cancel };
}

export default useAutoResolve;
