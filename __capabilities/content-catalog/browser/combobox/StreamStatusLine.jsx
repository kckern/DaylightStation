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
import { UnstyledButton } from '@mantine/core';
import { sourceLabel } from "../lib/sourceLabels.js";

/**
 * The sources a search scope asks for, from its params (`source=plex,abs`),
 * or null when the scope is everything (no `source=`).
 */
export function scopeSources(scopeParams) {
  const raw = new URLSearchParams(String(scopeParams ?? '')).get('source');
  if (!raw) return null;
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : null;
}

/**
 * Where each failed source is said (owner, 2026-11-27: "Photos did not answer"
 * rows on a search for a cartoon were noise):
 *  - a scoped search names its own failed library at the top (`rows`) — that
 *    library IS the answer;
 *  - a source the scope does not ask for is never mentioned (a widened or
 *    retried search's failures do not belong to the person's scope);
 *  - an everything search gathers its failures into ONE quiet line under the
 *    results (`note`), never a row per source.
 */
export function failurePlacement(failedSources = [], scopeParams = '') {
  const scoped = scopeSources(scopeParams);
  if (!scoped) return { rows: [], note: [...failedSources] };
  const serves = (source) => {
    const key = String(source).toLowerCase();
    return scoped.includes(key) || scoped.includes(key.split('-')[0]);
  };
  return { rows: failedSources.filter(serves), note: [] };
}

/**
 * The everything-search failure line: "Some libraries didn't answer · Retry",
 * at the bottom of the results. Retry asks each failed source again.
 */
export function SourceFailureNote({ failedSources = [], scopeParams = '', onRetry, testId = 'search-failure-note' }) {
  const { note } = failurePlacement(failedSources, scopeParams);
  if (note.length === 0) return null;
  return (
    <div data-testid={testId} className="search-failure-note" role="status">
      <span>Some libraries didn&apos;t answer</span>
      {onRetry && (
        <>
          <span aria-hidden="true">·</span>
          <UnstyledButton
            className="search-failure-note-retry"
            data-testid={`${testId}-retry`}
            // A pointer focus move would blur the search input and close the
            // list before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => note.forEach((source) => onRetry(source))}
          >
            Retry
          </UnstyledButton>
        </>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string[]} [props.pending] - source ids still streaming results
 * @param {{source: string, error: *}[]} [props.sourceErrors] - sources that
 *   reported an error this search. Arrives from useStreamingSearch as an
 *   ARRAY of {source, error} objects, not an object keyed by source name.
 * @param {(source: string) => void} [props.onRetry] - called per errored
 *   source's Retry button
 */
function failureLabel(source) {
  if (String(source).toLowerCase() === 'plex') return 'Plex';
  return sourceLabel(source) || source;
}

export function StreamStatusLine({ state = null, pending = [], sourceErrors = [], widening = null, onRetry, scopeParams = '' }) {
  const effectiveState = state ?? (widening?.active ? { sources: {}, failedSources: [] } : null);
  if (effectiveState) {
    const pendingSources = Object.entries(effectiveState.sources ?? {})
      .filter(([, status]) => status === 'pending')
      .map(([source]) => source);
    // Only the scope's own failures are named here; everything-search failures
    // go to SourceFailureNote under the results (failurePlacement).
    const failedSources = failurePlacement(effectiveState.failedSources ?? [], scopeParams).rows;
    const anyFailed = (effectiveState.failedSources ?? []).length > 0;
    if (pendingSources.length === 0 && failedSources.length === 0 && !widening?.active) return null;
    return (
      <div data-testid="stream-status-line" className="stream-status-line" aria-live="polite">
        {failedSources.map((source) => (
          <span key={source} className="stream-status-error-item">
            <span>{failureLabel(source)} did not answer</span>
            {onRetry && (
              <button type="button" className="stream-status-retry-btn"
                data-testid={`stream-status-retry-${source}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onRetry(source)}>
                Retry
              </button>
            )}
          </span>
        ))}
        {pendingSources.length > 0 && (
          <span className="stream-status-line--pending">
            <span>Still searching — {pendingSources.length} source{pendingSources.length === 1 ? '' : 's'} still answering</span>
          </span>
        )}
        {widening?.active && (
          <span className="stream-status-widening" data-testid={widening.testId || 'search-widening-divider'}>
            Not in {widening.from || 'this kind'} — <strong>From everything:</strong>{' '}
            {widening.resultCount > 0
              ? `${widening.resultCount} result${widening.resultCount === 1 ? '' : 's'}`
              : anyFailed
                ? 'results may be incomplete.'
              : `no matches. Check the spelling or browse ${widening.from || 'this kind'}.`}
          </span>
        )}
      </div>
    );
  }
  if (pending.length > 0) {
    return (
      <div data-testid="stream-status-line" className="stream-status-line stream-status-line--pending" aria-live="polite">
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
              // A pointer focus move would blur the combobox input and remove
              // this action before click. Keyboard activation remains native.
              onMouseDown={(event) => event.preventDefault()}
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
