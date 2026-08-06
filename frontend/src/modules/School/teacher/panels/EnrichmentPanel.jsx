/**
 * EnrichmentPanel — the enrichment log (wave 3, teacher.enrichment.log):
 * record out-of-band learning (educational travel, museums, projects) as
 * dated, subject-tagged, attributed entries, and read the household's log.
 * Entries are append-only evidence of their own kind — the report side
 * (wave 4) turns them into credit and pacing excusal.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';
import { SUBJECTS } from '../../home/subjects.js';

const EMPTY_FORM = { title: '', from: '', to: '', note: '', learnerIds: [], subjectIds: [] };

export default function EnrichmentPanel({ kids = [] }) {
  const entries = usePanelFetch(() => schoolApi.enrichment(), {
    panel: 'enrichment',
    isEmpty: (d) => !(d?.entries ?? []).length,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'enrichment' });
  const [form, setForm] = useState(EMPTY_FORM);
  const [open, setOpen] = useState(false);

  const toggleIn = (field, id) => setForm((f) => ({
    ...f,
    [field]: f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id],
  }));

  const save = () => run('save', ({ actorId, pin }) => schoolApi.postEnrichment({
    recordedBy: actorId, pin, title: form.title, from: form.from,
    to: form.to || null, note: form.note || null,
    learnerIds: form.learnerIds, subjectIds: form.subjectIds,
  }), { onSuccess: () => { setForm(EMPTY_FORM); setOpen(false); entries.retry(); } });

  return (
    <section className="teacher-panel" data-state={entries.state}>
      <h2 className="teacher-panel__title">Enrichment log</h2>
      {entries.state === 'loading' && <div className="teacher-panel__skeleton" aria-hidden />}
      {entries.state === 'error' && (
        <p className="teacher-panel__error">
          Couldn&rsquo;t load the Enrichment log.
          <button type="button" className="teacher-panel__retry" onClick={entries.retry}>Retry</button>
        </p>
      )}
      {(entries.state === 'ok' || entries.state === 'empty') && (
        <>
          {entries.state === 'empty' ? (
            <p className="teacher-panel__empty">Nothing recorded yet — trips, museums, and projects belong here.</p>
          ) : (
            <ul className="teacher-enrichment">
              {[...entries.data.entries].reverse().map((e) => (
                <li key={e.id} className="teacher-enrichment__row">
                  <span className="teacher-enrichment__title">{e.title}</span>
                  <span className="teacher-enrichment__dates">{e.from}{e.to !== e.from ? ` → ${e.to}` : ''}</span>
                  <span className="teacher-enrichment__meta">
                    {(e.learnerIds ?? []).join(', ')}{(e.subjectIds ?? []).length ? ` · ${e.subjectIds.join(', ')}` : ''}
                  </span>
                  {e.note && <span className="teacher-enrichment__note">{e.note}</span>}
                </li>
              ))}
            </ul>
          )}
          {!open && <button type="button" className="teacher-assignments__edit" onClick={() => setOpen(true)}>Record enrichment</button>}
          {open && (
            <div className="teacher-enrichment__form">
              <input aria-label="Title" placeholder="Title (e.g. Yellowstone trip)" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              <div className="teacher-enrichment__dates-row">
                <input aria-label="From" type="date" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} />
                <input aria-label="To" type="date" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} />
              </div>
              <div className="teacher-enrichment__picks">
                {kids.map((kid) => (
                  <label key={kid.id} className="teacher-assignments__pick">
                    <input type="checkbox" checked={form.learnerIds.includes(kid.id)} onChange={() => toggleIn('learnerIds', kid.id)} />
                    {kid.name}
                  </label>
                ))}
              </div>
              <div className="teacher-enrichment__picks">
                {SUBJECTS.map((s) => (
                  <label key={s.id} className="teacher-assignments__pick">
                    <input type="checkbox" checked={form.subjectIds.includes(s.id)} onChange={() => toggleIn('subjectIds', s.id)} />
                    {s.label}
                  </label>
                ))}
              </div>
              <textarea aria-label="Note" placeholder="What made it school?" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              <div className="teacher-assignments__actions">
                <button type="button" disabled={busy === 'save'} onClick={save}>Save</button>
                <button type="button" onClick={() => { setOpen(false); setForm(EMPTY_FORM); }}>Cancel</button>
              </div>
              {errors.save && <p className="teacher-panel__error">{errors.save}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
