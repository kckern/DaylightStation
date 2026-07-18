// Composer.jsx — mode root: gallery ⇄ new-song setup ⇄ editor, wired to the
// composition API, the active piano user, config, and the chrome breadcrumb.
// Distinct from the Composers educational-reference mode (great composers).
import { useEffect, useState, useCallback } from 'react';
import './Composer.scss';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoBreadcrumbBar } from '../../PianoBreadcrumbContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { useCompositionsApi } from './useCompositionsApi.js';
import { parseMusicXml } from './model/index.js';
import { Gallery } from './Gallery.jsx';
import { NewSongSetup } from './NewSongSetup.jsx';
import { EditorSurface } from './EditorSurface.jsx';
import { ComposerBar } from './ComposerBar.jsx';

export function Composer() {
  const { config } = usePianoKioskConfig();
  const { setCrumbs } = usePianoBreadcrumbBar();
  const { currentUser } = usePianoUser();
  const api = useCompositionsApi(currentUser);
  const [view, setView] = useState('gallery'); // 'gallery' | 'new' | 'editor'
  const [open, setOpen] = useState(null); // { id, title, score, revision }

  // PianoChrome already renders the "Composer" mode crumb — publish only the
  // deeper segment (the open song's title), and clear it back out when we
  // leave the editor (or unmount) so a sibling route isn't left with a stale
  // crumb — mirrors usePianoBreadcrumb's own cleanup guard.
  useEffect(() => {
    const mine = view === 'editor' && open ? [{ label: open.title || 'Song' }] : [];
    setCrumbs(mine);
    return () => setCrumbs((cur) => (cur === mine ? [] : cur));
  }, [view, open, setCrumbs]);

  const openSong = useCallback(async (id) => {
    const { meta, musicxml } = await api.get(id);
    setOpen({ id, title: meta?.title, score: parseMusicXml(musicxml), revision: meta?.revision });
    setView('editor');
  }, [api]);

  const backToGallery = useCallback(() => {
    setOpen(null);
    setView('gallery');
  }, []);

  return (
    <section className="piano-mode piano-mode--composer">
      {view === 'gallery' && (
        currentUser ? (
          <Gallery list={api.list} onOpen={openSong} onNew={() => setView('new')} />
        ) : (
          <p className="piano-mode__placeholder">Loading…</p>
        )
      )}
      {view === 'new' && <NewSongSetup create={api.create} onCreated={openSong} />}
      {view === 'editor' && open && (
        <EditorSurface
          key={open.id}
          initialScore={open.score}
          songId={open.id}
          initialRevision={open.revision}
          save={api.save}
          config={config.composer || {}}
        />
      )}
      <ComposerBar canBack={view !== 'gallery'} onBack={backToGallery} onUndo={() => {}} onRedo={() => {}} />
    </section>
  );
}

export default Composer;
