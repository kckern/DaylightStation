import { useEffect, useState } from 'react';
import MaterialsSection from '../materials/MaterialsSection.jsx';
import ContinueRail from './ContinueRail.jsx';
import KindSection from './KindSection.jsx';
import { KINDS, groupByKind } from './kinds.js';
import { subjectLabel } from './subjects.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import { schoolApi } from '../schoolApi.js';
import { rankWithin, gradeFromBirthyear } from './ranking.js';

/**
 * One subject's shelf, redesigned around the four content KINDS (Watch /
 * Listen / Apps / Practice) rather than by source type. The kind layout is
 * handed to MaterialsSection as its `renderCatalog` — the *catalog* layer of
 * the grid → detail → player flow — so descending into a material's detail
 * (or its player) REPLACES the whole kind wall, not just the materials grid.
 * That is the shelf/detail hierarchy fix: Apps and Practice, which used to
 * sit below MaterialsSection as sibling groups and so lingered on screen once
 * a detail opened, now live INSIDE the swapped-out catalog and disappear with
 * it.
 */
// Built-in program launchers per subject — first-class School programs that
// aren't Plex/bank content (a typing drill, a writing surface later). Each
// opens a top-level section. Kept here (a frontend routing concern) rather
// than in the content pipeline, the same split PROGRAMS makes.
const SUBJECT_PROGRAMS = {
  writing: [{ id: 'typing', label: 'Typing', hint: 'Learn to touch-type', section: 'typing' }],
};

export default function SubjectPage({ subjectId, shelf, guestOnly, onLaunch, notice, onOpen, initialMaterialPath = [], onMaterialNav }) {
  // SubjectPage owns the per-subject progress fetch (rather than each consumer
  // fetching its own copy) because `materialProgress` fans out a Plex read per
  // material on the backend — expensive. The fetched list feeds BOTH the
  // ranking below AND is handed to ContinueRail as a prop so it does not
  // self-fetch (one fetch per subject open, not two).
  const { currentUser } = useSchoolProfile();
  const userId = currentUser?.id ?? null;
  const [progress, setProgress] = useState(null); // null = not loaded yet

  useEffect(() => {
    let alive = true;
    if (!userId) { setProgress([]); return () => { alive = false; }; }
    setProgress(null);
    schoolApi.materialProgress(userId, subjectId).then(({ ok, data }) => {
      if (!alive) return;
      setProgress(ok && Array.isArray(data) ? data : []);
    });
    return () => { alive = false; };
  }, [userId, subjectId]);

  const studentGrade = currentUser?.birthyear
    ? gradeFromBirthyear(currentUser.birthyear, new Date().getFullYear())
    : null;
  const progressList = progress ?? [];

  const programs = SUBJECT_PROGRAMS[subjectId] ?? [];
  const grouped = groupByKind({ shelf, programs });
  // Guests only see generic decks (preserve BankBrowser's guest rule).
  if (guestOnly) grouped.decks = grouped.decks.filter((b) => b.audience === 'generic');
  // Language courses (the only `apps` entries besides subject programs) carry
  // no `hint` of their own -- AppTile's blurb falls back to it, so give them
  // the same default blurb the old hard-coded course tile always showed.
  // Programs (e.g. typing) already set their own `hint` and pass through.
  grouped.apps = grouped.apps.map((item) => (item.hint ? item : { ...item, hint: 'Listen, say it, write it' }));

  const anyContent = KINDS.some((k) => grouped[k.id].length > 0);
  if (!anyContent) {
    return (
      <div className="school-subject school-subject--empty">
        <p>Nothing on this shelf yet.</p>
      </div>
    );
  }

  // Per-kind tile action: video/audio open a material detail (MaterialsSection's
  // onSelect, given to renderCatalog); apps navigate to their section; decks
  // launch a quiz/flashcard runner (onLaunch returns a promise for DeckTile's
  // double-tap guard).
  const openFor = (kindId, onSelect) => {
    if (kindId === 'apps') return (item) => onOpen(item.section ?? `lang:${item.id}`);
    if (kindId === 'decks') return (item, mode) => onLaunch(item, mode);
    return onSelect; // video, audio
  };

  return (
    <MaterialsSection
      materials={shelf.materials}
      initialMaterialPath={initialMaterialPath}
      onMaterialNav={onMaterialNav}
      sectionLabel={subjectLabel(subjectId)}
      renderCatalog={({ onSelect }) => (
        <div className="school-subject">
          <ContinueRail subjectId={subjectId} materials={shelf.materials} onOpen={onSelect} progress={progressList} />
          {notice && <div className="school-subject__notice">{notice}</div>}
          {KINDS.map((kind) => (
            <KindSection
              key={kind.id}
              kind={kind}
              items={rankWithin(grouped[kind.id], { progress: progressList, studentGrade })}
              Tile={kind.Tile}
              onOpen={openFor(kind.id, onSelect)}
            />
          ))}
        </div>
      )}
    />
  );
}
