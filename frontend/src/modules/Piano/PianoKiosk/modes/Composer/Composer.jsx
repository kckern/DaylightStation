// Composer.jsx — mode root: a blank staff you can play into immediately, with a
// "Songs" gallery one tap away. Wired to the composition API, the active piano
// user, config, and the chrome breadcrumb. Distinct from the Composers
// educational-reference mode (great composers).
//
// UX spine (blank-staff-first): the mode LANDS on the editor showing a fresh,
// unsaved DRAFT (id === null) — no gallery gate, no title form. The first edit
// materializes the song server-side (EditorSurface → useAutosave.create), and
// `onMaterialized` records the assigned id so subsequent edits PUT. "Songs" (in
// the editor's own toolbar) opens the gallery of saved songs; "New song" (from
// the gallery) returns to a fresh blank staff. A draft that is never edited is
// never persisted, so entering and leaving leaves no junk behind.
//
// This root renders NO chrome of its own. It used to carry a full-width bottom
// bar for those two buttons — a fourth chrome strip stacked above browser bar,
// kiosk breadcrumb and editor toolbar, on a screen where the notation was
// already too small. Both controls now live where the state they act on lives.
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import './Composer.scss';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoBreadcrumbBar } from '../../PianoBreadcrumbContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { useCompositionsApi } from './useCompositionsApi.js';
import { parseMusicXml, makeEmptyScore } from './model/index.js';
import { Gallery } from './Gallery.jsx';
import { EditorSurface } from './EditorSurface.jsx';

let draftSeq = 0;
function makeDraft() {
  // A stable `key` (draft-N) keeps EditorSurface MOUNTED across materialization:
  // when the draft gains a real id, only `open.id` changes — remounting on an
  // id key would wipe the in-progress editor state and undo history.
  draftSeq += 1;
  return { key: `draft-${draftSeq}`, id: null, title: '', score: makeEmptyScore(), revision: 1 };
}

export function Composer() {
  // Session-logged mode logger: `sessionLog` routes every composer.* event to a
  // persisted per-session .jsonl on the backend (sessionFile transport), filed
  // under the `piano-composer` app. EditorSurface derives its own child from this
  // (passed as a prop) so the editor's events land in the same session log.
  const logger = useMemo(() => getLogger().child({ component: 'composer', app: 'piano-composer', sessionLog: true }), []);
  const { config } = usePianoKioskConfig();
  const { setCrumbs } = usePianoBreadcrumbBar();
  const { currentUser } = usePianoUser();
  const api = useCompositionsApi(currentUser, logger);
  const [view, setView] = useState('editor'); // 'editor' | 'gallery'
  const [open, setOpen] = useState(() => makeDraft()); // { key, id, title, score, revision }
  const openRef = useRef(open);
  openRef.current = open;

  // Mode lifecycle.
  useEffect(() => {
    logger.info('composer.mode.mounted', { user: currentUser ?? null });
    return () => logger.info('composer.mode.unmounted', {});
  }, [logger]); // eslint-disable-line react-hooks/exhaustive-deps -- mount-once lifecycle log

  // View transitions (editor ⇄ gallery) — the top-level navigation state.
  const viewRef = useRef(view);
  useEffect(() => {
    if (viewRef.current !== view) {
      logger.info('composer.mode.view', { from: viewRef.current, to: view });
      viewRef.current = view;
    }
  }, [view, logger]);

  // PianoChrome already renders the "Composer" mode crumb — publish only the
  // deeper segment (the open song's title) when editing a NAMED song, and clear
  // it back out when we leave the editor (or unmount) so a sibling route isn't
  // left with a stale crumb — mirrors usePianoBreadcrumb's own cleanup guard.
  useEffect(() => {
    const mine = view === 'editor' && open?.title ? [{ label: open.title }] : [];
    setCrumbs(mine);
    return () => setCrumbs((cur) => (cur === mine ? [] : cur));
  }, [view, open, setCrumbs]);

  const openSong = useCallback(async (id) => {
    logger.info('composer.song.open-start', { id });
    const t0 = Date.now();
    try {
      const { meta, musicxml } = await api.get(id);
      const score = parseMusicXml(musicxml);
      setOpen({ key: `song-${id}`, id, title: meta?.title || '', score, revision: meta?.revision || 1 });
      setView('editor');
      logger.info('composer.song.open', { id, title: meta?.title || '', revision: meta?.revision || 1, ms: Date.now() - t0 });
    } catch (err) {
      logger.error('composer.song.open-failed', { id, error: err?.message, ms: Date.now() - t0 });
    }
  }, [api, logger]);

  const newDraft = useCallback(() => {
    const draft = makeDraft();
    logger.info('composer.draft.new', { key: draft.key });
    setOpen(draft);
    setView('editor');
  }, [logger]);

  const showGallery = useCallback(() => setView('gallery'), []);

  // Renaming from the editor. The title lives HERE, not in EditorSurface, so
  // one commit feeds three things at once: the editor's own control, the
  // breadcrumb effect above (which only publishes a crumb for a NAMED song),
  // and the autosave `meta` EditorSurface derives from the prop. Applied to a
  // draft too — the name then rides along on the create when the first edit
  // materializes it.
  const renameOpen = useCallback((t) => {
    logger.info('composer.song.rename', { id: openRef.current?.id ?? null, named: !!t });
    setOpen((o) => ({ ...o, title: t }));
  }, [logger]);

  // The draft's first edit created the song: record the assigned id/revision
  // WITHOUT changing `open.key`, so the editor keeps its mounted state.
  const onMaterialized = useCallback((id, revision) => {
    logger.info('composer.draft.materialized', { id, revision, key: openRef.current?.key });
    setOpen((o) => (o && o.id == null ? { ...o, id, revision } : o));
  }, [logger]);

  return (
    <section className="piano-mode piano-mode--composer">
      {view === 'editor' && (
        <EditorSurface
          key={open.key}
          initialScore={open.score}
          songId={open.id}
          initialRevision={open.revision}
          title={open.title}
          onRename={renameOpen}
          save={api.save}
          create={api.create}
          onMaterialized={onMaterialized}
          onSongs={showGallery}
          config={config.composer || {}}
          logger={logger}
        />
      )}
      {view === 'gallery' && (
        currentUser ? (
          <Gallery list={api.list} onOpen={openSong} onNew={newDraft} />
        ) : (
          <p className="piano-mode__placeholder">Loading…</p>
        )
      )}
    </section>
  );
}

export default Composer;
