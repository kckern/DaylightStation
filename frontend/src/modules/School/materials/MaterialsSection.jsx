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
import SchoolMaterialPlayer from './SchoolMaterialPlayer.jsx';

const COURSE_NOTICE = 'Sign in for courses — guests get the listening shelf.';

export default function MaterialsSection({ materials, sectionLabel, initialMaterialId = null }) {
  const { currentUser, isGuest, openPicker } = useSchoolProfile();
  const [detailMaterial, setDetailMaterial] = useState(null); // null = grid

  // Deep link: open straight onto the requested material's detail once the
  // catalog row exists. One-shot — in-app navigation after that wins.
  const consumedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!initialMaterialId || consumedDeepLinkRef.current) return;
    const m = materials.find((x) => x.id === initialMaterialId);
    if (m) { consumedDeepLinkRef.current = true; setDetailMaterial(m); }
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

  const openDetail = useCallback((material) => {
    setNotice(null);
    setDetailMaterial(material);
  }, []);

  const backToGrid = useCallback(() => {
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
  // header renders it — grid → detail → player each add a crumb instead of
  // owning a back header. The section crumb returns to this grid; the material
  // crumb (in the player) returns to the detail. `sectionLabel` names the
  // shelf/section this grid belongs to (passed by SubjectPage/LibraryPage).
  const backToDetail = useCallback(() => setPlaying(null), []);
  const trail = useMemo(() => {
    if (playing) {
      return [
        { label: sectionLabel, onClick: backToGrid },
        { label: playing.material.title, onClick: backToDetail },
        { label: playing.unit.title },
      ];
    }
    if (detailMaterial) {
      return [
        { label: sectionLabel, onClick: backToGrid },
        { label: detailMaterial.title },
      ];
    }
    return []; // at the grid: the header shows the plain section crumb itself
  }, [playing, detailMaterial, sectionLabel, backToGrid, backToDetail]);
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
        onBack={backToGrid}
        onPlay={onPlay}
        notice={notice}
        sectionLabel={sectionLabel}
      />
    );
  }

  return <MaterialGrid materials={materials} onSelect={openDetail} />;
}
