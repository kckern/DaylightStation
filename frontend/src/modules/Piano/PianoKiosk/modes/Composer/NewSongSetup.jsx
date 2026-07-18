import { useState } from 'react';
import { makeEmptyScore, initEditor, serializeFromEditor } from './model/index.js';

export function NewSongSetup({ create, onCreated }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    const score = makeEmptyScore({ title: title.trim() || 'Untitled' });
    const musicxml = serializeFromEditor(initEditor(score));
    const rec = await create({ title: title.trim() || 'Untitled', musicxml });
    onCreated(rec.id);
  };

  return (
    <div className="composer-newsong">
      <input aria-label="Song title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title (optional)" />
      <button onClick={go} disabled={busy}>Skip → 4/4 · C · treble · 100bpm</button>
    </div>
  );
}
