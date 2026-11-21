import { useLayoutEffect, useRef, useState } from 'react';
import { DaylightAPI } from "../../../../frontend/src/lib/api.mjs";
import { localDateKey } from "../../../../frontend/src/lib/calendarDay.js";
import getLogger from "../../../../frontend/src/lib/logging/Logger.js";
import { feedQueueOwner } from "./offline/feedOfflineStore.js";

const log = getLogger().child({ app: 'feed', module: 'data-controls' });

export default function FeedDataControls({ onImported }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [refreshFailed, setRefreshFailed] = useState(false);
  const scopeRef = useRef(null);
  useLayoutEffect(() => {
    const scope = { owner: feedQueueOwner(), controller: new AbortController() };
    scopeRef.current = scope;
    return () => {
      scopeRef.current = null;
      scope.controller.abort();
    };
  }, []);
  const isCurrent = scope => scope && scopeRef.current === scope && scope.owner === feedQueueOwner();

  const refreshImportedView = async scope => {
    try {
      await onImported?.();
      if (isCurrent(scope)) setRefreshFailed(false);
    } catch (error) {
      if (!isCurrent(scope)) return;
      log.warn('feed.import.refresh_failed', { error: error.message });
      setRefreshFailed(true);
    }
  };

  const retryImportedViewRefresh = async () => {
    const scope = scopeRef.current;
    if (!isCurrent(scope)) return;
    setBusy(true);
    await refreshImportedView(scope);
    if (isCurrent(scope)) setBusy(false);
  };

  const exportData = async () => {
    const scope = scopeRef.current;
    if (!isCurrent(scope)) return;
    setBusy(true);
    setStatus('');
    setRefreshFailed(false);
    try {
      const data = await DaylightAPI('/api/v1/feed/data/export', {}, 'GET', { signal: scope.controller.signal });
      if (!isCurrent(scope)) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `daylight-feed-${localDateKey()}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus('Export downloaded.');
    } catch (error) {
      if (!isCurrent(scope)) return;
      log.warn('feed.export.failed', { error: error.message });
      setStatus('Export failed.');
    } finally {
      if (isCurrent(scope)) setBusy(false);
    }
  };

  const importData = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const scope = scopeRef.current;
    if (!file || !isCurrent(scope)) return;
    if (file.size > 50 * 1024 * 1024) {
      setStatus('Import files must be smaller than 50 MB.');
      return;
    }
    setBusy(true);
    setStatus('');
    setRefreshFailed(false);
    try {
      const text = await file.text();
      if (!isCurrent(scope)) return;
      const payload = JSON.parse(text);
      // A submitted import can commit after leaving. Its request keeps the original credentials.
      const result = await DaylightAPI('/api/v1/feed/data/import', payload, 'POST');
      if (!isCurrent(scope)) return;
      const counts = result.imported || {};
      const noteCount = counts.annotations || 0;
      setStatus(`Imported ${counts.items || 0} items, ${counts.states || 0} states, and ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}.`);
      await refreshImportedView(scope);
    } catch (error) {
      if (!isCurrent(scope)) return;
      log.warn('feed.import.failed', { error: error.message });
      const validationMessage = error.status === 400 && typeof error.body?.error === 'string'
        ? error.body.error
        : null;
      setStatus(error instanceof SyntaxError
        ? 'That file is not valid JSON.'
        : validationMessage || 'Import failed. Check that this is a Daylight Feed export.');
    } finally {
      if (isCurrent(scope)) setBusy(false);
    }
  };

  return (
    <div className="feed-data-controls">
      <span>Portable data</span>
      <div>
        <button type="button" disabled={busy} onClick={exportData}>Export</button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>Import</button>
        <input ref={inputRef} type="file" accept="application/json,.json" onChange={importData} className="feed-visually-hidden" tabIndex={-1} />
      </div>
      {status && (
        <div className="feed-data-controls__status" role="status">
          <small>{status}</small>
          {refreshFailed && (
            <>
              <small>The import succeeded, but the current view could not refresh.</small>
              <button type="button" disabled={busy} onClick={retryImportedViewRefresh}>Refresh view</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
