import { describe, expect, it } from 'vitest';
import { formatSentenceTrace } from './trace.mjs';
import { SEQ16_EVENTS } from './trace.fixture.mjs';

describe('formatSentenceTrace — the seq-16 recording sitting', () => {
  const out = formatSentenceTrace(SEQ16_EVENTS);

  it('heads the sitting with learner, corpus, day and trace', () => {
    expect(out.split('\n')[0]).toBe('# learner-a · glossika-korean · day 8 · trace run-seq16 · 41 events · 1:26.0');
  });

  it('groups the sentence under its rung', () => {
    expect(out).toContain('seq 16 · recording');
  });

  it('shows the cut with every piece span and the sentence length', () => {
    expect(out).toContain('cut piece 0 at 3611ms (raw 3702, snapped) → pieces 0–3611 | 3611–5400 of 5400ms  [key:ArrowRight · prompting]');
  });

  it('shows each piece take against its span, with voiced / silent / trailing silence', () => {
    expect(out).toContain('take piece 1 1.3s of span 1.8s · voiced 1.0s silent 0.2s end-silence 0.1s  [key:Space · recording]');
    expect(out).toContain('take piece 1 16.5s of span 1.8s · voiced 2.1s silent 14.1s end-silence 11.3s  [key:Space · recording]');
  });

  it('names what drove every restart, and from which phase', () => {
    const restarts = out.split('\n').filter((l) => l.includes('restart piece'));
    expect(restarts).toHaveLength(3);
    expect(restarts.every((l) => l.includes('[key:Tab'))).toBe(true);
    expect(restarts[1]).toContain('restart piece 1 from prompting');
  });

  it('shows playback and review idle, so a gap reads as one or the other', () => {
    expect(out).toContain('▶ take piece 1 16.5s ended');
    expect(out).toContain('idle on review 2.5s');
    expect(out).toContain('joined take 17.7s');
    expect(out).toContain('stitched 2 pieces → 17.7s · voiced 3.0s silent 14.3s end-silence 11.3s  [key:Space · review]');
  });

  it('calls out the silent warning', () => {
    expect(out).toContain('silent warning after 2.0s (piece 1)');
    expect(out).toContain('silent cleared after 3.1s (piece 1)');
  });

  it('ends the sentence with a summary', () => {
    expect(out).toContain(
      'summary: pieces 2 · takes 4 (refused 0) · redos 2 · restarts 3 (key:Tab×3) · playback 55.3s · review idle 7.0s · stalls 0 · kept (joined)',
    );
  });

  it('orders by traceSeq, not by arrival', () => {
    const shuffled = [...SEQ16_EVENTS].reverse();
    expect(formatSentenceTrace(shuffled)).toBe(out);
  });

  it('reads a JSON-string pieceSpans, as the log store returns an array field', () => {
    const events = SEQ16_EVENTS.map((e) => (e.data.pieceSpans
      ? { ...e, data: { ...e.data, pieceSpans: JSON.stringify(e.data.pieceSpans) } } : e));
    expect(formatSentenceTrace(events)).toBe(out);
  });

  it('renders a stall', () => {
    const stall = {
      msg: 'school.language.rung.stalled', level: 'warn',
      data: { traceId: 'run-seq16', traceSeq: 999, t: 130000, seq: 16, rung: 'recording', phase: 'review', ms: 45000, screen: 'visible', detail: 'stalled' },
    };
    const text = formatSentenceTrace([...SEQ16_EVENTS, stall]);
    expect(text).toContain('STALLED 45s at review (screen visible)');
    expect(text).toContain('stalls 1');
  });

  it('returns an empty string for no sentence-ladder events', () => {
    expect(formatSentenceTrace([])).toBe('');
    expect(formatSentenceTrace([{ msg: 'school.word-ladder.item.shown', data: {} }])).toBe('');
  });
});

describe('formatSentenceTrace — the chunked flow (2026-09-23)', () => {
  const e = (name, traceSeq, t, data) => ({
    msg: `school.language.capture.${name}`,
    data: { traceId: 'run-2', learnerId: 'learner-a', corpus: 'c', day: 9, traceSeq, t, seq: 3, ...data },
  });
  const out = formatSentenceTrace([
    e('hear', 1, 1000, { from: 'recording', piece: 1, via: 'key:Tab', phase: 'recording' }),
    e('auto-stop', 2, 5000, { piece: 1, silentMs: 3000, via: 'auto', phase: 'recording' }),
    e('restart', 3, 6000, { from: 'review', pieces: 2, via: 'key:ArrowLeft', phase: 'review' }),
    e('stitched', 4, 9000, { pieces: 1, partial: true, of: 2, durationMs: 1500, voicedMs: 1200, silentMs: 300, endSilentMs: 100, via: 'key:Enter', phase: 'review' }),
  ]);
  it('names each new step and what drove it', () => {
    expect(out).toContain('hear piece 1  [key:Tab · recording]');
    expect(out).toContain('auto-stop piece 1 after 3.0s of silence  [auto · recording]');
    expect(out).toContain('start over (2 pieces dropped)  [key:ArrowLeft · review]');
    expect(out).toContain('stitched 1 pieces → 1.5s · voiced 1.2s silent 0.3s end-silence 0.1s · PARTIAL  [key:Enter · review]');
    expect(out).toContain('restarts 1 (key:ArrowLeft×1) · auto-stops 1');
  });
});
