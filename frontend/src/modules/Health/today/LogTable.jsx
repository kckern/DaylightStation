import { useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { BUCKETS, UNGROUPED } from './mealBuckets.js';
import { EntryRow } from './EntryRow.jsx';
import { groupRows } from './groupRows.js';

// Numeric-tolerant bucket-total sum. A group row carries zero nutrition BY
// DESIGN (its children carry the real values as siblings in this same flat
// `rows` array), so summing every row — groups included — already counts
// each gram of food exactly once. Do NOT filter `kind:'group'` out here:
// that would change nothing (they're already zero) while inviting someone
// to "fix" it into double-counting if a group ever did carry a value.
const kcal = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.calories) || 0), 0));

function Section({ label, rows, onAdd, onRowTap, onConfirm, headerAction }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const entries = groupRows(rows);

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <section className="health-meal">
      <header className="health-meal__header">
        <h4 className="health-meal__label">{label}</h4>
        <span className="health-meal__header-right">
          <span className="health-meal__kcal">{rows.length ? `${kcal(rows)} kcal` : '—'}</span>
          {headerAction || null}
        </span>
      </header>
      {entries.map(({ row, children, rollup }) => {
        const key = row.uuid ?? row.id;
        // Render as a group whenever groupRows() actually attached
        // children — NEVER gate this on row.kind. groupRows() attaches a
        // child to ANY row its parentId resolves to, regardless of the
        // parent's kind, and nothing upstream guarantees only
        // kind:'group' rows carry children. Gating on kind here would
        // silently drop the children from the screen.
        const isGroup = children.length > 0;
        if (!isGroup) {
          return <EntryRow key={key} row={row} onTap={onRowTap} onConfirm={onConfirm} />;
        }
        const isOpen = expanded.has(key);
        return (
          <div key={key} className="health-group">
            <EntryRow
              row={row} onTap={onRowTap} onConfirm={onConfirm}
              isGroup expanded={isOpen} onToggle={() => toggle(key)} rollupKcal={rollup.calories}
            />
            {isOpen ? children.map((c) => (
              <EntryRow key={c.uuid ?? c.id} row={c} onTap={onRowTap} onConfirm={onConfirm} child />
            )) : null}
          </div>
        );
      })}
      {onAdd ? (
        <UnstyledButton className="health-meal__add" onClick={onAdd}>+ Add food…</UnstyledButton>
      ) : null}
    </section>
  );
}

export function LogTable({ byBucket, sessions = [], onAddTo, onRowTap, onConfirm, addSlot, addingTo, bucketHeaderAction }) {
  const orphans = byBucket.get(null) || [];
  return (
    <div className="health-log">
      {BUCKETS.map((b) => {
        const rows = byBucket.get(b.id) || [];
        return (
          <div key={b.id}>
            <Section label={b.label} rows={rows}
              onAdd={() => onAddTo(b.id)} onRowTap={onRowTap} onConfirm={onConfirm}
              headerAction={bucketHeaderAction ? bucketHeaderAction(b.id, rows, b.label) : null} />
            {addingTo === b.id && addSlot ? addSlot : null}
          </div>
        );
      })}
      {sessions.length ? (
        <section className="health-meal health-meal--exercise">
          <header className="health-meal__header">
            <h4 className="health-meal__label">Exercise</h4>
            <span className="health-meal__kcal">+{kcal(sessions)} kcal</span>
          </header>
          {sessions.map((s, i) => (
            <div key={i} className="health-row health-row--readonly">
              <span className="health-row__name">{s.type || s.title || 'Workout'}</span>
              <span className="health-row__portion">{(s.minutes ?? s.duration_min) ? `${Math.round(s.minutes ?? s.duration_min)} min` : ''}</span>
              <span className="health-row__kcal">+{Math.round(s.calories || 0)}</span>
            </div>
          ))}
        </section>
      ) : null}
      {orphans.length ? (
        <Section label={UNGROUPED.label} rows={orphans} onRowTap={onRowTap} onConfirm={onConfirm} />
      ) : null}
    </div>
  );
}
export default LogTable;
