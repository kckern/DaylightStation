import { useRef, useState } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const log = getLogger().child({ app: 'feed', module: 'data-controls' });

export default function FeedDataControls({ onImported }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const exportData = async () => {
    setBusy(true);
    setStatus('');
    try {
      const data = await DaylightAPI('/api/v1/feed/data/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `daylight-feed-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus('Export downloaded.');
    } catch (error) {
      log.warn('feed.export.failed', { error: error.message });
      setStatus('Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const importData = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setStatus('Import files must be smaller than 50 MB.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const payload = JSON.parse(await file.text());
      const result = await DaylightAPI('/api/v1/feed/data/import', payload, 'POST');
      const counts = result.imported || {};
      const noteCount = counts.annotations || 0;
      setStatus(`Imported ${counts.items || 0} items, ${counts.states || 0} states, and ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}.`);
      try { await onImported?.(); }
      catch (refreshError) { log.warn('feed.import.refresh_failed', { error: refreshError.message }); }
    } catch (error) {
      log.warn('feed.import.failed', { error: error.message });
      setStatus(error instanceof SyntaxError ? 'That file is not valid JSON.' : 'Import failed. Check that this is a Daylight Feed export.');
    } finally {
      setBusy(false);
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
      {status && <small role="status">{status}</small>}
    </div>
  );
}
