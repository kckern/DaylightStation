// frontend/src/modules/Content/combobox/StreamStatusLine.jsx
// One-line, fixed-height status for the ~16-source streaming search. Replaces
// the per-source badge cloud that used to fill ContentCombobox's dropdown
// header (a Badge per adapter: FILES, PLEX, LOCAL-CONTENT, QUERY, FRESHVIDEO,
// CANVAS-FILESYSTEM, RETROARCH, …) — on a 360px phone that cloud filled the
// entire above-the-fold area before a single result rendered, showing the
// household the backend adapter roster instead of results (spec D3).
//
// Renders nothing once the search has settled with no errors. While sources
// are still streaming, shows a single spinner + count line. Once settled with
// one or more source failures, shows one segment per errored source (source
// id resolved through sourceLabels so a raw adapter slug never leaks to the
// UI) with a Retry affordance. All content stays on one row — it scrolls
// horizontally rather than wrapping — so the line's height never grows with
// the number of pending/errored sources and never displaces the result list
// beneath it.
//
// Lives beside its only mounter (ContentCombobox.jsx) rather than under
// Media/ — this is a shared/generic combobox component, and a Content ->
// Media import would invert that boundary for every ContentCombobox consumer
// (including Admin/PlaybackHub). Props stay surface-agnostic (pending,
// sourceErrors, onRetry) so a later task can mount the same component from a
// full-screen mobile search surface without change. Styles live in
// ContentCombobox.scss (imported by the mounter, not here) for the same
// reason. sourceLabel comes from Content/lib/sourceLabels.js — it moved out
// of Media/search/ into the shared module too, since it's consumed from both
// Content (here) and Media (resultPresentation.js) and has no imports of its
// own to tie it to either side.
import React from 'react';
import { sourceLabel } from '../lib/sourceLabels.js';

/**
 * @param {object} props
 * @param {string[]} [props.pending] - source ids still streaming results
 * @param {{source: string, error: *}[]} [props.sourceErrors] - sources that
 *   reported an error this search. Arrives from useStreamingSearch as an
 *   ARRAY of {source, error} objects, not an object keyed by source name.
 * @param {(source: string) => void} [props.onRetry] - called per errored
 *   source's Retry button
 */
export function StreamStatusLine({ pending = [], sourceErrors = [], onRetry }) {
  if (pending.length > 0) {
    return (
      <div data-testid="stream-status-line" className="stream-status-line stream-status-line--pending" aria-live="polite">
        <span className="stream-status-spinner" aria-hidden="true" />
        <span>Searching {pending.length} source{pending.length === 1 ? '' : 's'}…</span>
      </div>
    );
  }

  if (!sourceErrors || sourceErrors.length === 0) return null;

  return (
    <div data-testid="stream-status-line" className="stream-status-line stream-status-line--error" aria-live="polite">
      {sourceErrors.map(({ source }) => (
        <span key={source} className="stream-status-error-item">
          {sourceLabel(source) || source} didn&apos;t answer
          {onRetry && (
            <button
              type="button"
              className="stream-status-retry-btn"
              data-testid={`stream-status-retry-${source}`}
              onClick={() => onRetry(source)}
            >
              Retry
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

export default StreamStatusLine;
