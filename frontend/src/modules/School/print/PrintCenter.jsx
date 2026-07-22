/**
 * PrintCenter — a child finds a worksheet and prints it on the kitchen laser
 * printer, gated by the rolling page quota. Under budget prints straight away;
 * over budget files a request a grown-up approves. The parent surface (pending
 * approvals) shows only when an adult is the current user — a child can't
 * approve their own print.
 *
 * Dumb-ish: all policy is server-side (PrintService); this component reflects
 * the returned decision and the quota banner. Guests see the catalogue but the
 * print action tells them to sign in (the server also rejects a guest print).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';

function useAdult(currentUser) {
  return useMemo(() => {
    if (!currentUser?.birthyear) return false;
    return new Date().getFullYear() - currentUser.birthyear >= 18;
  }, [currentUser]);
}

export default function PrintCenter() {
  const { currentUser, roster, openPicker } = useSchoolProfile();
  const isAdult = useAdult(currentUser);
  const [printables, setPrintables] = useState(null);
  const [quota, setQuota] = useState(null);
  const [pending, setPending] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null); // { kind, text }

  const nameFor = useCallback((id) => roster.find((u) => u.id === id)?.name ?? id, [roster]);

  const refreshQuota = useCallback(() => {
    if (!currentUser?.id) { setQuota(null); return; }
    schoolApi.printQuota(currentUser.id).then(({ ok, data }) => { if (ok) setQuota(data); });
  }, [currentUser?.id]);

  const refreshPending = useCallback(() => {
    schoolApi.printPending().then(({ ok, data }) => { if (ok && Array.isArray(data)) setPending(data); });
  }, []);

  useEffect(() => {
    let alive = true;
    schoolApi.printables().then(({ ok, data }) => { if (alive) setPrintables(ok && Array.isArray(data) ? data : []); });
    return () => { alive = false; };
  }, []);
  useEffect(refreshQuota, [refreshQuota]);
  useEffect(() => { if (isAdult) refreshPending(); }, [isAdult, refreshPending]);

  const onPrint = useCallback(async (p) => {
    if (!currentUser?.id) { openPicker(); return; }
    setBusyId(p.id);
    setFlash(null);
    const { ok, data } = await schoolApi.requestPrint({ userId: currentUser.id, printableId: p.id, copies: 1 });
    setBusyId(null);
    if (!ok || !data) { setFlash({ kind: 'error', text: 'Print failed — try again.' }); return; }
    schoolLog.print(data.decision, { printableId: p.id, pages: data.pages });
    if (data.decision === 'printed') setFlash({ kind: 'ok', text: `Printing “${p.label}” — check the kitchen printer.` });
    else if (data.decision === 'approval') setFlash({ kind: 'wait', text: `“${p.label}” needs a grown-up's OK — asked them for you.` });
    else setFlash({ kind: 'error', text: data.reason || 'That can\'t be printed right now.' });
    refreshQuota();
    if (isAdult) refreshPending();
  }, [currentUser?.id, openPicker, refreshQuota, isAdult, refreshPending]);

  const onApprove = useCallback(async (req, approve) => {
    if (!currentUser?.id) return;
    setBusyId(req.id);
    const fn = approve ? schoolApi.approvePrint : schoolApi.denyPrint;
    const { ok } = await fn(req.id, currentUser.id);
    setBusyId(null);
    if (ok) { schoolLog.print(approve ? 'approve' : 'deny', { requestId: req.id }); refreshPending(); }
  }, [currentUser?.id, refreshPending]);

  return (
    <div className="school-print">
      {quota && (
        <div className="school-print__quota">
          <span className="school-print__quota-count">{quota.remaining} of {quota.pagesPerWindow}</span>
          <span className="school-print__quota-label">pages left to print this hour</span>
        </div>
      )}
      {flash && <div className={`school-print__flash school-print__flash--${flash.kind}`}>{flash.text}</div>}

      {printables === null && <p className="school-print__muted">Loading…</p>}
      {printables !== null && printables.length === 0 && (
        <p className="school-print__muted">Nothing to print yet.</p>
      )}
      {printables !== null && printables.length > 0 && (
        <ul className="school-print__grid">
          {printables.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="school-print__card"
                onClick={() => onPrint(p)}
                disabled={busyId === p.id}
              >
                <span className="school-print__card-icon" aria-hidden="true">🖨️</span>
                <span className="school-print__card-body">
                  <span className="school-print__card-label">{p.label}</span>
                  <span className="school-print__card-meta">
                    {p.pages != null ? `${p.pages} page${p.pages === 1 ? '' : 's'}` : 'worksheet'}
                  </span>
                </span>
                <span className="school-print__card-action">{busyId === p.id ? '…' : 'Print'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isAdult && pending.length > 0 && (
        <section className="school-print__approvals">
          <h3 className="school-print__approvals-heading">Waiting for your OK</h3>
          <ul className="school-print__approvals-list">
            {pending.map((req) => (
              <li key={req.id} className="school-print__approval">
                <span className="school-print__approval-text">
                  <strong>{nameFor(req.userId)}</strong> wants to print <strong>{req.label}</strong> ({req.pages} pages)
                </span>
                <span className="school-print__approval-actions">
                  <button type="button" className="school-print__approve" disabled={busyId === req.id} onClick={() => onApprove(req, true)}>Allow</button>
                  <button type="button" className="school-print__deny" disabled={busyId === req.id} onClick={() => onApprove(req, false)}>No</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
