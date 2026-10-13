import { createCanvas } from 'canvas';

const safe = (value) => String(value ?? '—');

/** Deterministic rendered result artifact; this is not a scan photograph. */
export function renderSessionResultPng(model) {
  const { items = [], score, kind, sessionId, title, subtitle } = model ?? {};
  const height = Math.max(720, 390 + items.length * 58);
  const canvas = createCanvas(1200, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f2e7'; ctx.fillRect(0, 0, 1200, height);
  ctx.fillStyle = '#17324d'; ctx.fillRect(0, 0, 1200, 170);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('Rendered result', 70, 76);
  ctx.font = '25px sans-serif'; ctx.fillText('Generated from OMR evidence — not a photograph of the answer card', 70, 125);
  ctx.fillStyle = '#17324d'; ctx.font = 'bold 36px sans-serif';
  ctx.fillText(title, 70, 235);
  ctx.font = '24px sans-serif'; ctx.fillText(subtitle, 70, 278);
  ctx.font = 'bold 76px sans-serif';
  ctx.fillText(score?.percent == null ? 'No score' : `${score.percent}%`, 70, 365);
  ctx.font = '24px sans-serif';
  if (score?.correctCount != null && score?.totalCount != null) ctx.fillText(`${score.correctCount} of ${score.totalCount} correct`, 390, 348);
  items.forEach((item, index) => {
    const y = 440 + index * 58;
    const verdict = item.verdict;
    ctx.fillStyle = verdict === 'correct' ? '#1b7f4b' : verdict === 'incorrect' ? '#a6382d' : '#8b6f31';
    ctx.beginPath(); ctx.arc(88, y - 8, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#17324d'; ctx.font = 'bold 23px sans-serif';
    ctx.fillText(`Question ${item.questionNumber}`, 120, y);
    ctx.font = '22px sans-serif'; ctx.fillText(`Mark: ${safe(item.given)}  ·  ${verdict}`, 390, y);
  });
  ctx.fillStyle = '#6a645b'; ctx.font = '20px sans-serif';
  ctx.fillText(`Session ${safe(sessionId)} · ${kind}`, 70, height - 45);
  return canvas.toBuffer('image/png');
}

export default renderSessionResultPng;
