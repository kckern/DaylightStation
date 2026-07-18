import { useState } from 'react';
import { makeEmptyScore, initEditor, serializeFromEditor } from './model/index.js';

export function NewSongSetup({ create, onCreated }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const score = makeEmptyScore({ title: title.trim() || 'Untitled' });
      const musicxml = serializeFromEditor(initEditor(score));
      const rec = await create({ title: title.trim() || 'Untitled', musicxml });
      onCreated(rec.id);
    } catch (e) {
      setError(e?.message || 'Failed to create song. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-newsong">
      <input aria-label="Song title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title (optional)" />
      <button onClick={go} disabled={busy}>Skip → 4/4 · C · treble · 100bpm</button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
