// useAutosave.js — debounce + client-side re-parse validation gate + persist.
//
// On editorState.dirty changing, waits idleMs (default 3000) then serializes the
// editor state and re-parses it as a client-side validation gate: a parse failure
// blocks the save entirely (status:'invalid'), keeping whatever was last saved.
// Only a successfully re-parsed serialization is persisted.
//
// LAZY MATERIALIZE (blank-staff-first UX): the Composer lands on an unsaved
// DRAFT (id === null) so a kid starts on a blank staff with zero friction. The
// first real edit is what creates the song server-side: when dirty fires with no
// id, we POST via `create` instead of PUT via `save`, then hand the new id back
// through `onMaterialized` so the parent can keep saving it. Opening the composer
// and playing nothing therefore leaves NO junk "Untitled" row — creation is
// earned by an edit. A busy guard around the create prevents a second debounce
// tick (or unmount flush) from racing in and creating a duplicate song.
import { useEffect, useRef, useState, useCallback } from 'react';
import { serializeFromEditor, parseMusicXml } from './model/index.js';

export function useAutosave({ editorState, id, revision, save, create, title, onMaterialized, meta, idleMs = 3000 }) {
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);
  const idRef = useRef(id);
  const revRef = useRef(revision);
  const creatingRef = useRef(false);
  useEffect(() => { idRef.current = id; }, [id]);
  useEffect(() => { revRef.current = revision; }, [revision]);

  const doSave = useCallback(async () => {
    if (!editorState?.dirty) return; // no-op on a clean editor — never persist zero edits
    let xml;
    try {
      xml = serializeFromEditor(editorState);
      parseMusicXml(xml); // client validation gate — throws on bad xml
    } catch {
      setStatus('invalid');   // block the save, keep last-good
      return;
    }

    // No id yet → this is a draft's first edit: materialize it (POST).
    if (!idRef.current) {
      if (!create) return;            // nothing to persist to (shouldn't happen in the mode)
      if (creatingRef.current) return; // a create is already in flight — let it finish
      creatingRef.current = true;
      setStatus('saving');
      try {
        const rec = await create({ title: (title || '').trim() || 'Untitled', musicxml: xml });
        if (rec && rec.id) {
          idRef.current = rec.id;
          revRef.current = rec.revision || 1;
          onMaterialized?.(rec.id, revRef.current);
          setStatus('saved');
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      } finally {
        creatingRef.current = false;
      }
      return;
    }

    // Existing song → PUT the new revision.
    setStatus('saving');
    try {
      const r = await save(idRef.current, { musicxml: xml, meta, revision: revRef.current });
      if (r && r.ok) { revRef.current = r.revision; setStatus('saved'); }
      else setStatus('error');
    } catch { setStatus('error'); }
  }, [editorState, save, create, title, onMaterialized, meta]);

  useEffect(() => {
    if (!editorState?.dirty) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(doSave, idleMs);
    return () => clearTimeout(timer.current);
  }, [editorState, idleMs, doSave]);

  const flush = useCallback(() => { clearTimeout(timer.current); doSave(); }, [doSave]);
  return { status, flush };
}
