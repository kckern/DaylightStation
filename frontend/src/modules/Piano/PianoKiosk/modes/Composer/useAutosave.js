// useAutosave.js — debounce + client-side re-parse validation gate + PUT.
//
// On editorState.dirty changing, waits idleMs (default 3000) then serializes the
// editor state and re-parses it as a client-side validation gate: a parse failure
// blocks the save entirely (status:'invalid'), keeping whatever was last saved.
// Only a successfully re-parsed serialization is sent to `save`.
import { useEffect, useRef, useState, useCallback } from 'react';
import { serializeFromEditor, parseMusicXml } from './model/index.js';

export function useAutosave({ editorState, id, revision, save, meta, idleMs = 3000 }) {
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);
  const revRef = useRef(revision);
  useEffect(() => { revRef.current = revision; }, [revision]);

  const doSave = useCallback(async () => {
    if (!id) return;
    if (!editorState?.dirty) return; // no-op flush on a clean editor — don't bump revision / add a version-ring entry for zero edits
    let xml;
    try {
      xml = serializeFromEditor(editorState);
      parseMusicXml(xml); // client validation gate — throws on bad xml
    } catch {
      setStatus('invalid');   // block the save, keep last-good
      return;
    }
    setStatus('saving');
    try {
      const r = await save(id, { musicxml: xml, meta, revision: revRef.current });
      if (r && r.ok) { revRef.current = r.revision; setStatus('saved'); }
      else setStatus('error');
    } catch { setStatus('error'); }
  }, [editorState, id, save, meta]);

  useEffect(() => {
    if (!editorState?.dirty) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(doSave, idleMs);
    return () => clearTimeout(timer.current);
  }, [editorState, idleMs, doSave]);

  const flush = useCallback(() => { clearTimeout(timer.current); doSave(); }, [doSave]);
  return { status, flush };
}
