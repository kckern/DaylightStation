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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import MaterialGrid from './MaterialGrid.jsx';
import MaterialDetail from './MaterialDetail.jsx';
import SchoolMaterialPlayer from './SchoolMaterialPlayer.jsx';

const COURSE_NOTICE = 'Sign in for courses — guests get the listening shelf.';

export default function MaterialsSection({ materials, sectionLabel }) {
  const { currentUser, isGuest, openPicker } = useSchoolProfile();
  const [detailMaterial, setDetailMaterial] = useState(null); // null = grid
  const [playing, setPlaying] = useState(null); // {material, unit} | null
  const [notice, setNotice] = useState(null);
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

  if (playing) {
    return (
      <SchoolMaterialPlayer
        material={playing.material}
        unit={playing.unit}
        userId={currentUser?.id}
        onExit={() => setPlaying(null)}
      />
    );
  }

  if (detailMaterial) {
    return (
      <MaterialDetail
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
