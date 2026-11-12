/**
 * Calibration of the practice-like weighting against the engagement audit.
 *
 * Fixtures: __fixtures__/audit-sittings.json (real sittings, human notes only,
 * labelled engaged / low-touch / absentee / rhythm-loop by the audit) and
 * __fixtures__/mash.mjs (synthetic mashing). Targets: play-along 13, low-touch 5.
 *
 * Results with PRACTICE_DEFAULTS (2026-11-12) are printed by this test and
 * recorded in __docs/reference/piano/lesson-engagement.md.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { tallyPractice, classifyBurst, PRESCHOOL_PRACTICE } from './practiceScore.mjs';
import { goodFaithScore, PRESCHOOL_POLICY, GOOD_FAITH_DEFAULTS } from './goodFaith.mjs';
import { mashSittings } from './__fixtures__/mash.mjs';
import { cutBursts } from './__fixtures__/bursts.mjs';

const FIXTURE = new URL('./__fixtures__/audit-sittings.json', import.meta.url);
const sittings = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const TARGET = { 'play-along': 13, 'low-touch': 5 };
// Fixture note times are seconds (ms precision); mash notes are ms.
const evs = (notes) => notes.map(([t, note, velocity]) => ({ t: Math.round(t * 1000), note, velocity }));
const mevs = (notes) => notes.map(([t, note, velocity]) => ({ t, note, velocity }));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

describe('practice weighting calibration', () => {
  const engaged = sittings.filter((s) => s.label === 'engaged' && s.notes.length >= 16);
  const absent = sittings.filter((s) => s.label === 'absentee' || s.label === 'rhythm-loop');
  const mash = mashSittings(1);

  it('engaged sittings keep their notes; mash and absentees never pass', () => {
    const ret = engaged.map((s) => tallyPractice(evs(s.notes)).retention);
    const med = pct(ret, 0.5);
    const p10 = pct(ret, 0.1);

    let falseRejects = 0;
    let rejectBase = 0;
    for (const s of sittings.filter((x) => x.label === 'engaged')) {
      const targetNpm = TARGET[s.lessonType] ?? 13;
      const rawScore = goodFaithScore({ practiceNotes: s.notes.length, playedSec: s.playedSec, targetNpm });
      if (rawScore < 6) continue;
      rejectBase += 1;
      const t = tallyPractice(evs(s.notes));
      if (goodFaithScore({ practiceNotes: t.practiceNotes, playedSec: s.playedSec, targetNpm }) < 6) falseRejects += 1;
    }
    let falseAccepts = 0;
    for (const s of absent) {
      const t = tallyPractice(evs(s.notes));
      if (goodFaithScore({ practiceNotes: t.practiceNotes, playedSec: s.playedSec, targetNpm: TARGET[s.lessonType] ?? 13 }) >= 6) falseAccepts += 1;
    }
    const mashRet = {};
    for (const m of mash) {
      const t = tallyPractice(mevs(m.notes));
      mashRet[m.kind] = Math.round(t.retention * 1000) / 1000;
      // A mash sitting against a play-along lesson.
      if (goodFaithScore({ practiceNotes: t.practiceNotes, playedSec: m.durationSec, targetNpm: 13 }) >= 6) falseAccepts += 1;
    }
    const report = {
      engaged: { n: engaged.length, medianRetention: +med.toFixed(3), p10Retention: +p10.toFixed(3) },
      falseRejects: { n: falseRejects, of: rejectBase, rate: +(falseRejects / Math.max(1, rejectBase)).toFixed(3) },
      falseAccepts: { n: falseAccepts, of: absent.length + mash.length },
      mashRetention: mashRet,
    };
    // eslint-disable-next-line no-console -- calibration report, read by the builder
    console.info('[calibration] sittings', JSON.stringify(report));
    expect(med).toBeGreaterThanOrEqual(0.85);
    expect(p10).toBeGreaterThanOrEqual(0.6);
    expect(falseRejects / Math.max(1, rejectBase)).toBeLessThanOrEqual(0.05);
    expect(falseAccepts).toBe(0);
    for (const r of Object.values(mashRet)) expect(r).toBeLessThanOrEqual(0.2);
  });

  it('bursts: engaged rarely spam, mash never legit', () => {
    const eb = engaged.flatMap((s) => cutBursts(evs(s.notes)));
    const mb = mash.flatMap((m) => cutBursts(mevs(m.notes), 10));
    const count = (bs) => {
      const c = { legit: 0, spam: 0, ambiguous: 0 };
      for (const b of bs) c[classifyBurst(b).verdict] += 1;
      return c;
    };
    const ec = count(eb);
    const mc = count(mb);
    const report = {
      engaged: { n: eb.length, ...ec, spamRate: +(ec.spam / eb.length).toFixed(3), ambiguousRate: +(ec.ambiguous / eb.length).toFixed(3) },
      mash: { n: mb.length, ...mc, ambiguousRate: +(mc.ambiguous / mb.length).toFixed(3) },
    };
    // eslint-disable-next-line no-console -- calibration report
    console.info('[calibration] bursts', JSON.stringify(report));
    expect(ec.spam / eb.length).toBeLessThanOrEqual(0.05);
    expect(mc.legit).toBe(0);
  });

  it('preschool mode on the two youngest learners\' sittings', () => {
    const pre = sittings.filter((x) => x.cohort === 'preschool');
    const judge = (s, opts, policy) => {
      const t = tallyPractice(evs(s.notes), opts);
      return goodFaithScore({ practiceNotes: t.practiceNotes, playedSec: s.playedSec, targetNpm: TARGET[s.lessonType] ?? 13 }) >= policy.passScore;
    };
    const rate = (rows, opts, policy, want) => {
      const n = rows.filter((s) => judge(s, opts, policy) !== want).length;
      return { n, of: rows.length, rate: +(n / Math.max(1, rows.length)).toFixed(3) };
    };
    const eng = pre.filter((s) => s.label === 'engaged');
    const abs = pre.filter((s) => s.label === 'absentee' || s.label === 'rhythm-loop');
    const report = {
      preschool: { engagedRejected: rate(eng, PRESCHOOL_PRACTICE, PRESCHOOL_POLICY, true), absenteeAccepted: rate(abs, PRESCHOOL_PRACTICE, PRESCHOOL_POLICY, false) },
      schoolRulesOnSameSittings: { engagedRejected: rate(eng, {}, GOOD_FAITH_DEFAULTS, true), absenteeAccepted: rate(abs, {}, GOOD_FAITH_DEFAULTS, false) },
    };
    // eslint-disable-next-line no-console -- calibration report
    console.info('[calibration] preschool', JSON.stringify(report));
    expect(report.preschool.absenteeAccepted.n).toBe(0);
    expect(report.preschool.engagedRejected.rate).toBeLessThanOrEqual(report.schoolRulesOnSameSittings.engagedRejected.rate);
    expect(report.preschool.engagedRejected.rate).toBeLessThanOrEqual(0.05);
  });
});
