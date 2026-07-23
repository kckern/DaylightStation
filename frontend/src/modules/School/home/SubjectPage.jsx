import { useEffect, useState } from 'react';
import MaterialsSection from '../materials/MaterialsSection.jsx';
import SubjectShelves from './SubjectShelves.jsx';
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

export default function SubjectPage({ subjectId, shelf, guestOnly, onLaunch, notice, onOpen, initialMaterialPath = [], onMaterialNav, catalogLoading = false }) {
  // SubjectPage owns the per-subject progress fetch because `materialProgress`
  // fans out a Plex read per material on the backend — expensive. The fetched
  // list feeds the ranking (started work floats to the front of its shelf) and
  // the tiles' progress underline. One fetch per subject open.
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
  // Join per-user progress onto the matching material (progress.materialId ===
  // item.id) so Watch/Listen tiles can render their percent underline. Only
  // video/audio items match a progress row; apps/decks pass through untouched.
  const progressById = new Map(progressList.map((p) => [p.materialId, p]));
  const withProgress = (items) => items.map((it) => {
    const p = progressById.get(it.id);
    return p ? { ...it, percent: p.percent } : it;
  });

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
  // The catalog is Plex-backed and slow on a cold cache (first open after a
  // redeploy). While it's still loading, show a skeleton row — NOT the empty
  // state, which reads as "stuck/broken" during a legitimate load.
  if (!anyContent && catalogLoading) {
    return (
      <div className="school-subject school-subject--loading" aria-hidden="true">
        <div className="school-shelf-band">
          {[0, 1, 2, 3].map((i) => <span key={i} className="school-skel__poster" />)}
        </div>
      </div>
    );
  }
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
      renderCatalog={({ onSelect }) => {
        // One shelf per kind (ranked, progress-joined); the packer bands them.
        const shelves = KINDS.map((kind) => ({
          kindId: kind.id,
          verb: kind.verb,
          icon: kind.icon,
          token: kind.token,
          Tile: kind.Tile,
          items: rankWithin(withProgress(grouped[kind.id]), { progress: progressList, studentGrade }),
          onOpen: openFor(kind.id, onSelect),
        }));
        return (
          <div className="school-subject">
            {notice && <div className="school-subject__notice">{notice}</div>}
            <SubjectShelves shelves={shelves} />
          </div>
        );
      }}
    />
  );
}
