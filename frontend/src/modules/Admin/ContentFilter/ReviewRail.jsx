import { useRef } from 'react';
import { useFocusRegion } from '../../../lib/ui/index.js';
import { Button, Text, VisuallyHidden } from '@mantine/core';
import { ApproveButton } from './ReviewHeader.jsx';
import { SignOffPanel } from './SignOffPanel.jsx';
import { ApprovalFeedback } from './FilmApprovalControls.jsx';

/**
 * The film's stages as one row of interlocking chevrons that are also the page's tabs (owner,
 * 2026-11-22): Refine › Review › Approve, each with where it stands (reviewRail.js), then Plays, a
 * plain tab for the parts that are only browsed. A tab sets the review scope's `stage`, which drives
 * the list, the timeline and stepping.
 */
const MARK = { complete: '✓', stuck: '!' };
const STATE_WORD = { complete: 'done', current: 'in hand', waiting: 'waiting', stuck: 'stuck' };
export const PANEL_ID = 'cf-stage-panel';
export const tabId = (key) => `cf-stage-tab-${key}`;

export function ReviewRail({ stages = [], plays = 0, value, onChange = () => {} }) {
  const refs = useRef({});
  const keys = [...stages.map((s) => s.key), 'plays'];
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const at = keys.indexOf(value);
    const to = e.key === 'ArrowRight' ? (at + 1) % keys.length : e.key === 'ArrowLeft' ? (at + keys.length - 1) % keys.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (keys[to] !== value) onChange(keys[to], 'key');
    refs.current[keys[to]]?.focus();
  };
  // A click selects without keeping focus, so ← → go on stepping through the parts.
  const tab = (key, selected) => ({
    type: 'button', role: 'tab', id: tabId(key), 'aria-selected': selected, 'aria-controls': PANEL_ID, tabIndex: selected ? 0 : -1,
    ref: (node) => { refs.current[key] = node; }, 'data-stage': key,
    onMouseDown: (e) => e.preventDefault(), onClick: () => { if (!selected) onChange(key, 'click'); },
  });
  return (
    <div className="cf-rail" role="tablist" aria-label="Stages" onKeyDown={onKeyDown}>
      {stages.map((s, i) => (
        // `check`: the stage has run, but parts of it wait for a look (amber, never a plain green check).
        <button key={s.key} {...tab(s.key, value === s.key)} data-state={s.state} data-check={s.check || undefined} title={s.title}
          className={`cf-rail__stage is-${s.state}${s.check ? ' has-check' : ''}`}>
          <span className="cf-rail__in">
            <span className="cf-rail__mark" aria-hidden="true">{s.check ? '!' : MARK[s.state] || i + 1}</span>
            <span className="cf-rail__name">{s.label}</span>
            <VisuallyHidden>{`, ${s.check ? 'timing unsure' : STATE_WORD[s.state]}: `}</VisuallyHidden>
            <span className="cf-rail__text">{s.text}</span>
          </span>
        </button>
      ))}
      <button {...tab('plays', value === 'plays')} title="Parts that play as they are: browse only"
        className="cf-rail__plays">
        <span className="cf-rail__in">Plays <span className="cf-rail__count">{plays}</span></span>
      </button>
    </div>
  );
}

/** The Approve tab's panel, in place of the part card: what is missing, or the sign-off itself. */
export function ApprovePanel({ data, approval, tally, running = false, onReview = null }) {
  const signOff = data.signOff || null;
  const ready = !signOff?.parent && data.status?.next === 'approve';
  const open = Math.max(0, (tally?.total || 0) - (tally?.done || 0));
  // One named region for the whole panel: Approve becomes Withdraw in place, and focus stays here.
  const outer = useFocusRegion(approval.busy);
  return (
    <div {...outer.regionProps} role="region" aria-label="Family approval" className="cf-card-part cf-approve" data-state={signOff?.parent ? 'approved' : ready ? 'ready' : 'not-ready'}>
      <Text fw={700}>{signOff?.parent ? 'Approved for family' : ready ? 'Ready to approve for family' : 'Not ready to approve yet'}</Text>
      {ready ? (
        <>
          <Text size="sm">{`${tally.done} of ${tally.total} filtered parts have a verdict, and nothing else is missing.`}</Text>
          <ApproveButton approval={approval} outer={outer} />
          {/* A withdrawal turns this panel back to Approve; its result is still said here. */}
          {approval.action === 'withdraw' ? <ApprovalFeedback feedback={approval} onRetry={() => { outer.focus(); approval.retry(); }} /> : null}
        </>
      ) : (
        <>
          {!signOff?.parent ? <Text size="sm" c="dimmed">{signOff?.missing?.length ? 'Still missing:' : 'The film cannot be approved in its current state.'}</Text> : null}
          <SignOffPanel signOff={signOff} approval={approval} outer={outer} busyText={running ? 'A run is open' : null} />
          {/* Not a dead end: the way back to the parts that still need a verdict. */}
          {!signOff?.parent && open && onReview ? (
            <Button size="compact-sm" onMouseDown={(e) => e.preventDefault()} onClick={onReview}>{`Review the ${open} part${open === 1 ? '' : 's'} without a verdict`}</Button>
          ) : null}
        </>
      )}
    </div>
  );
}

export default ReviewRail;
