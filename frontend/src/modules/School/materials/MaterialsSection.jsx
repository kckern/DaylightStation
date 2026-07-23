/**
 * A catalog-driven section (`cat:<category>`, spec §2b/§3). Owns the internal
 * grid -> detail -> player flow for that one category (the header's own back
 * button, owned by SchoolShell, already handles section -> home from
 * anywhere in here).
 *
 * Identity gating (spec §6) lives here, not in MaterialDetail/MaterialGrid
 * (both stay dumb/presentational, same as BankBrowser): tapping a unit in a
 * `course` material while unclaimed opens the shared ProfilePicker with a
 * local pending-launch; picking a profile launches the pending unit; an
 * explicit-guest dismissal (or an already-explicit guest tapping a course
 * unit directly) shows a notice and does NOT launch. Non-course materials
 * (listening, reference, ...) are never gated -- they play with whatever
 * identity is (or isn't) current.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import { useSchoolBreadcrumb } from '../SchoolBreadcrumbContext.jsx';
import MaterialGrid from './MaterialGrid.jsx';
import MaterialDetail from './MaterialDetail.jsx';
import CollectionDetail from './CollectionDetail.jsx';
import SchoolMaterialPlayer from './SchoolMaterialPlayer.jsx';

const COURSE_NOTICE = 'Sign in for courses — guests get the listening shelf.';

export default function MaterialsSection({ materials, sectionLabel, initialMaterialId = null }) {
  const { currentUser, isGuest, openPicker } = useSchoolProfile();
  // Three levels below the grid for an audio anthology (collection → work →
  // chapter); a video show or a plain material skips the collection level.
  const [collection, setCollection] = useState(null); // opened collection material | null
  const [detailMaterial, setDetailMaterial] = useState(null); // a work or plain material | null

  // Deep link: open straight onto the requested material's detail once the
  // catalog row exists. One-shot — in-app navigation after that wins.
  const consumedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!initialMaterialId || consumedDeepLinkRef.current) return;
    const m = materials.find((x) => x.id === initialMaterialId);
    if (m) {
      consumedDeepLinkRef.current = true;
      if (m.kind === 'collection') setCollection(m); else setDetailMaterial(m);
    }
  }, [initialMaterialId, materials]);
  const [playing, setPlaying] = useState(null); // {material, unit} | null
  const [notice, setNotice] = useState(null);
  // Bumped whenever the player exits with {refetch:true} (lock state may
  // have changed — a completed unit can unlock the next one). Keying
  // MaterialDetail on it forces a fresh mount -> fresh units fetch,
  // independent of whether the playing/detail toggle happens to remount it
  // anyway (it does today via the conditional-return branch swap below, but
  // this makes the refetch contract explicit and test-provable rather than
  // an accident of the current render shape).
  const [detailKey, setDetailKey] = useState(0);
  // A tap that triggered the picker, awaiting claim/dismiss -- ref (not
  // state) because it's read/cleared from the identity-change effect below,
  // the same pending-launch shape SchoolShell uses for banks.
  const pendingRef = useRef(null);

  useEffect(() => {
    if (!pendingRef.current) return;
    if (currentUser) {
      const p = pendingRef.current;
      pendingRef.current = null;
      setNotice(null);
      setPlaying(p);
    } else if (isGuest) {
      pendingRef.current = null;
      setNotice(COURSE_NOTICE);
    }
  }, [currentUser, isGuest]);

  // From the grid: a collection opens its works browser; anything else opens
  // its unit detail directly.
  const openDetail = useCallback((material) => {
    setNotice(null);
    if (material.kind === 'collection') setCollection(material);
    else setDetailMaterial(material);
  }, []);

  // From a collection's works browser: open the chosen work's chapter list.
  const openWork = useCallback((work) => {
    setNotice(null);
    setDetailMaterial(work);
  }, []);

  const backToGrid = useCallback(() => {
    setNotice(null);
    setCollection(null);
    setDetailMaterial(null);
  }, []);

  // From a work back up to its collection's works browser (only meaningful
  // when a collection is open).
  const backToCollection = useCallback(() => {
    setNotice(null);
    setDetailMaterial(null);
  }, []);

  const onPlay = useCallback((unit) => {
    if (detailMaterial?.category === 'course') {
      if (!currentUser && !isGuest) {
        pendingRef.current = { material: detailMaterial, unit };
        openPicker();
        return;
      }
      if (isGuest) {
        setNotice(COURSE_NOTICE);
        return;
      }
    }
    setNotice(null);
    setPlaying({ material: detailMaterial, unit });
  }, [detailMaterial, currentUser, isGuest, openPicker]);

  const onPlayerExit = useCallback((opts) => {
    if (opts?.refetch) setDetailKey((k) => k + 1);
    setPlaying(null);
  }, []);

  // Publish this subtree's breadcrumb trail (past the apple home anchor) so the
  // header renders it — grid → [collection] → detail → player each add a crumb
  // instead of owning a back header. Each ancestor crumb carries the handler
  // that returns to it; `sectionLabel` names the shelf this grid belongs to.
  const backToDetail = useCallback(() => setPlaying(null), []);
  const trail = useMemo(() => {
    const crumbs = [{ label: sectionLabel, onClick: backToGrid }];
    // A collection ancestor (audio anthology) sits between the section and the
    // work; deeper crumbs return through it.
    if (collection) crumbs.push({ label: collection.title, onClick: backToCollection });
    if (playing) {
      crumbs.push({ label: playing.material.title, onClick: backToDetail });
      crumbs.push({ label: playing.unit.title });
      return crumbs;
    }
    if (detailMaterial) {
      crumbs.push({ label: detailMaterial.title });
      return crumbs;
    }
    if (collection) return crumbs; // collection open, no work yet
    return []; // at the grid: the header shows the plain section crumb itself
  }, [playing, detailMaterial, collection, sectionLabel, backToGrid, backToCollection, backToDetail]);
  useSchoolBreadcrumb(trail);

  if (playing) {
    return (
      <SchoolMaterialPlayer
        material={playing.material}
        unit={playing.unit}
        userId={currentUser?.id}
        onExit={onPlayerExit}
      />
    );
  }

  if (detailMaterial) {
    return (
      <MaterialDetail
        key={detailKey}
        material={detailMaterial}
        userId={currentUser?.id}
        onBack={collection ? backToCollection : backToGrid}
        onPlay={onPlay}
        notice={notice}
        sectionLabel={collection ? collection.title : sectionLabel}
      />
    );
  }

  if (collection) {
    return <CollectionDetail collection={collection} onOpenWork={openWork} />;
  }

  return <MaterialGrid materials={materials} onSelect={openDetail} />;
}
