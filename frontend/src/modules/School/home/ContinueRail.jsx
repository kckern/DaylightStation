// "Continue where you left off" rail: the claimed student's in-progress
// materials for THIS subject, most-recent first, capped at 4. Material-progress
// source only (Task 6.2 scope note) — active language reports and recent decks
// are a deferred follow-up, not unioned here. Renders nothing for a guest, an
// unclaimed device, or when there's no in-progress work on this shelf.
import { useEffect, useMemo, useState } from 'react';
import Icon from './icons/Icon.jsx';
import ContinueTile from './tiles/ContinueTile.jsx';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

export default function ContinueRail({ subjectId, materials, onOpen }) {
  const { currentUser } = useSchoolProfile();
  const userId = currentUser?.id ?? null;
  const [rows, setRows] = useState(null); // null = not-loaded/idle

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setRows([]); // guest/unclaimed: no rail, no fetch
      return undefined;
    }
    schoolApi.materialProgress(userId, subjectId).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) schoolLog.home('continue-fetch-failed', { subject: subjectId });
      setRows(ok && Array.isArray(data) ? data : []);
    });
    return () => { alive = false; };
  }, [userId, subjectId]);

  const list = useMemo(() => {
    if (!rows) return [];
    return rows
      .map((row) => {
        const material = materials.find((m) => m.id === row.materialId);
        if (!material) return null;
        return { ...material, ...row, title: material.title, poster: material.poster };
      })
      .filter((item) => item && item.unitTotal > 0 && item.unitsDone < item.unitTotal)
      .slice(0, 4);
  }, [rows, materials]);

  useEffect(() => {
    if (rows === null) return;
    schoolLog.home('continue-rail', { subject: subjectId, count: list.length });
  }, [rows, list, subjectId]);

  if (list.length === 0) return null;

  return (
    <section className="school-continue" aria-label="Continue">
      <h2 className="school-continue__head">
        <Icon name="play" /> <span>Continue</span>
      </h2>
      <ul className="school-continue__list">
        {list.map((it) => <ContinueTile key={it.materialId} item={it} onOpen={onOpen} />)}
      </ul>
    </section>
  );
}
