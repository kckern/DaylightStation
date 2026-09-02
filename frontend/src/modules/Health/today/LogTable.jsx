import { UnstyledButton } from '@mantine/core';
import { BUCKETS, UNGROUPED } from './mealBuckets.js';
import { EntryRow } from './EntryRow.jsx';

const kcal = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.calories) || 0), 0));

function Section({ label, rows, onAdd, onRowTap }) {
  return (
    <section className="health-meal">
      <header className="health-meal__header">
        <h4 className="health-meal__label">{label}</h4>
        <span className="health-meal__kcal">{rows.length ? `${kcal(rows)} kcal` : '—'}</span>
      </header>
      {rows.map((row) => <EntryRow key={row.uuid} row={row} onTap={onRowTap} />)}
      {onAdd ? (
        <UnstyledButton className="health-meal__add" onClick={onAdd}>+ Add food…</UnstyledButton>
      ) : null}
    </section>
  );
}

export function LogTable({ byBucket, sessions = [], onAddTo, onRowTap, addSlot, addingTo }) {
  const orphans = byBucket.get(null) || [];
  return (
    <div className="health-log">
      {BUCKETS.map((b) => (
        <div key={b.id}>
          <Section label={b.label} rows={byBucket.get(b.id) || []}
            onAdd={() => onAddTo(b.id)} onRowTap={onRowTap} />
          {addingTo === b.id && addSlot ? addSlot : null}
        </div>
      ))}
      {sessions.length ? (
        <section className="health-meal health-meal--exercise">
          <header className="health-meal__header">
            <h4 className="health-meal__label">Exercise</h4>
            <span className="health-meal__kcal">+{kcal(sessions)} kcal</span>
          </header>
          {sessions.map((s, i) => (
            <div key={i} className="health-row health-row--readonly">
              <span className="health-row__name">{s.type || s.title || 'Workout'}</span>
              <span className="health-row__portion">{s.duration_min ? `${Math.round(s.duration_min)} min` : ''}</span>
              <span className="health-row__kcal">+{Math.round(s.calories || 0)}</span>
            </div>
          ))}
        </section>
      ) : null}
      {orphans.length ? (
        <Section label={UNGROUPED.label} rows={orphans} onRowTap={onRowTap} />
      ) : null}
    </div>
  );
}
export default LogTable;
