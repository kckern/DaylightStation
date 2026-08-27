import { createCanvas } from 'canvas';

const safe = (value) => String(value ?? '—');

/** Deterministic rendered result artifact; this is not a scan photograph. */
export function renderSessionResultPng(session, { kind = 'effective' } = {}) {
  const items = session?.reviewEvidence ?? [];
  const score = kind === 'machine' ? session?.scores?.machine : session?.scores?.effective;
  const height = Math.max(720, 390 + items.length * 58);
  const canvas = createCanvas(1200, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f2e7'; ctx.fillRect(0, 0, 1200, height);
  ctx.fillStyle = '#17324d'; ctx.fillRect(0, 0, 1200, 170);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('Rendered result', 70, 76);
  ctx.font = '25px sans-serif'; ctx.fillText('Generated from OMR evidence — not a photograph of the answer card', 70, 125);
  ctx.fillStyle = '#17324d'; ctx.font = 'bold 36px sans-serif';
  ctx.fillText(session?.taxonomy?.lessonTitle ?? session?.state?.unitId ?? 'School work', 70, 235);
  ctx.font = '24px sans-serif'; ctx.fillText(`${kind === 'machine' ? 'Original machine score' : 'Current effective score'} · Revision ${safe(session?.revision)}`, 70, 278);
  ctx.font = 'bold 76px sans-serif';
  ctx.fillText(score?.percent == null ? 'No score' : `${score.percent}%`, 70, 365);
  ctx.font = '24px sans-serif';
  if (score?.correctCount != null && score?.totalCount != null) ctx.fillText(`${score.correctCount} of ${score.totalCount} correct`, 390, 348);
  items.forEach((item, index) => {
    const y = 440 + index * 58;
    const machineVerdict = item.verdict ?? 'unresolved';
    const correction = session?.state?.gradeAdjustments?.filter((row) => !row.retracted).at(-1)?.itemVerdicts
      ?.find((row) => row.itemId === item.itemId);
    // A correction record carries every printed question, including the ones
    // it deliberately left out of the score (`voided: true`). Those hold
    // `correct: false` only because the event schema wants a boolean — reading
    // it as a mark would print "incorrect" beside a question nobody could
    // mark. The machine verdict ("void") is the true thing to show.
    const verdict = kind === 'effective' && correction && correction.voided !== true
      ? (correction.correct ? 'correct' : 'incorrect') : machineVerdict;
    ctx.fillStyle = verdict === 'correct' ? '#1b7f4b' : verdict === 'incorrect' ? '#a6382d' : '#8b6f31';
    ctx.beginPath(); ctx.arc(88, y - 8, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#17324d'; ctx.font = 'bold 23px sans-serif';
    ctx.fillText(`Question ${item.questionNumber ?? index + 1}`, 120, y);
    ctx.font = '22px sans-serif'; ctx.fillText(`Mark: ${safe(item.given)}  ·  ${verdict}`, 390, y);
  });
  ctx.fillStyle = '#6a645b'; ctx.font = '20px sans-serif';
  ctx.fillText(`Session ${safe(session?.sessionId)} · ${kind}`, 70, height - 45);
  return canvas.toBuffer('image/png');
}

export function renderMachineScanResultPng({ sessionId, unitId, card }) {
  const correctCount = card.results.filter((row) => row.status === 'correct').length;
  const totalCount = card.results.length;
  return renderSessionResultPng({
    sessionId, revision: 1, taxonomy: { lessonTitle: unitId ?? card.documentId },
    scores: { machine: { percent: totalCount ? Math.round((correctCount / totalCount) * 10000) / 100 : 0,
      correctCount, totalCount } },
    reviewEvidence: card.results.map((row) => ({ itemId: row.itemId, questionNumber: row.row,
      given: row.given, verdict: row.status })),
    state: { unitId, gradeAdjustments: [] },
  }, { kind: 'machine' });
}

export default renderSessionResultPng;
