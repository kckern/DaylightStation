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
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { serializeFromEditor, parseMusicXml } from './model/index.js';
import getLogger from '../../../../../lib/logging/Logger.js';

export function useAutosave({ editorState, id, revision, save, create, title, onMaterialized, meta, idleMs = 3000, logger }) {
  const log = useMemo(() => logger || getLogger().child({ component: 'composer-autosave' }), [logger]);
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);
  const idRef = useRef(id);
  const revRef = useRef(revision);
  const creatingRef = useRef(false);
  useEffect(() => { idRef.current = id; }, [id]);
  useEffect(() => { revRef.current = revision; }, [revision]);

  const doSave = useCallback(async (trigger) => {
    if (!editorState?.dirty) return; // no-op on a clean editor — never persist zero edits
    let xml;
    try {
      xml = serializeFromEditor(editorState);
      parseMusicXml(xml); // client validation gate — throws on bad xml
    } catch (err) {
      // Blocked save keeps last-good on disk; warn so a persistent 'invalid'
      // toolbar state has a traceable cause.
      setStatus('invalid');
      log.warn('composer.autosave.invalid', { id: idRef.current ?? null, trigger, error: err?.message });
      return;
    }

    // No id yet → this is a draft's first edit: materialize it (POST).
    if (!idRef.current) {
      if (!create) return;            // nothing to persist to (shouldn't happen in the mode)
      if (creatingRef.current) return; // a create is already in flight — let it finish
      creatingRef.current = true;
      setStatus('saving');
      const t0 = Date.now();
      log.info('composer.autosave.materialize-start', { title: (title || '').trim() || 'Untitled', xmlLen: xml.length, trigger });
      try {
        const rec = await create({ title: (title || '').trim() || 'Untitled', musicxml: xml });
        if (rec && rec.id) {
          idRef.current = rec.id;
          revRef.current = rec.revision || 1;
          onMaterialized?.(rec.id, revRef.current);
          setStatus('saved');
          log.info('composer.autosave.materialized', { id: rec.id, revision: revRef.current, ms: Date.now() - t0 });
        } else {
          setStatus('error');
          log.error('composer.autosave.materialize-failed', { reason: 'no id returned', ms: Date.now() - t0 });
        }
      } catch (err) {
        setStatus('error');
        log.error('composer.autosave.materialize-failed', { error: err?.message, ms: Date.now() - t0 });
      } finally {
        creatingRef.current = false;
      }
      return;
    }

    // Existing song → PUT the new revision.
    setStatus('saving');
    const t0 = Date.now();
    log.debug('composer.autosave.save-start', { id: idRef.current, revision: revRef.current, xmlLen: xml.length, trigger });
    try {
      const r = await save(idRef.current, { musicxml: xml, meta, revision: revRef.current });
      if (r && r.ok) {
        revRef.current = r.revision;
        setStatus('saved');
        log.info('composer.autosave.saved', { id: idRef.current, revision: r.revision, ms: Date.now() - t0 });
      } else {
        setStatus('error');
        // A stale-revision 409 surfaces here as ok:false — the most likely
        // "my edit didn't stick" cause, so log the server's current revision.
        log.error('composer.autosave.save-rejected', { id: idRef.current, sentRevision: revRef.current, current: r?.current ?? null, ms: Date.now() - t0 });
      }
    } catch (err) {
      setStatus('error');
      log.error('composer.autosave.save-error', { id: idRef.current, error: err?.message, ms: Date.now() - t0 });
    }
  }, [editorState, save, create, title, onMaterialized, meta, log]);

  useEffect(() => {
    if (!editorState?.dirty) return undefined;
    clearTimeout(timer.current);
    log.debug('composer.autosave.scheduled', { id: idRef.current ?? null, idleMs, revision: editorState.revision });
    timer.current = setTimeout(() => doSave('debounce'), idleMs);
    return () => clearTimeout(timer.current);
  }, [editorState, idleMs, doSave, log]);

  const flush = useCallback(() => { clearTimeout(timer.current); log.debug('composer.autosave.flush', { id: idRef.current ?? null, dirty: !!editorState?.dirty }); doSave('flush'); }, [doSave, editorState, log]);
  return { status, flush };
}
