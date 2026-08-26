import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runRekey, rewriteLearnerIds } from './learner.mjs';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-rekey-'));
  const school = path.join(root, 'household', 'apps', 'school');
  fs.mkdirSync(path.join(school, 'assignments'), { recursive: true });
  fs.mkdirSync(path.join(school, 'sessions', '2026-08-01'), { recursive: true });
  fs.mkdirSync(path.join(root, 'users', 'learner4', 'apps', 'school'), { recursive: true });
  fs.writeFileSync(path.join(school, 'assignments', 'learner4.yml'), yaml.dump({ learnerId: 'learner4', courses: ['math'], assignedBy: 'kckern' }));
  fs.writeFileSync(path.join(school, 'milestones.yml'), yaml.dump([
    { id: 'm1', learnerId: 'learner4', unitId: 'u1' },
    { id: 'm2', learnerId: 'learner3', unitId: 'u2' },
  ]));
  fs.writeFileSync(path.join(school, 'enrichment.yml'), yaml.dump([
    { id: 'e1', learnerIds: ['learner4', 'learner3'], recordedBy: 'kckern' },
  ]));
  fs.writeFileSync(path.join(school, 'sessions', '2026-08-01', 'ses_1.yml'), yaml.dump([
    { type: 'created', learnerId: 'learner4', sessionId: 'ses_1' },
    // the household session reassignment EVENT (M8 fix 4): fromLearnerId /
    // toLearnerId are the fields the reducer derives learnerId from
    { type: 'reassigned', sessionId: 'ses_1', fromLearnerId: 'learner4', toLearnerId: 'learner4', reassignedBy: 'kckern' },
  ]));
  fs.writeFileSync(path.join(root, 'users', 'learner4', 'apps', 'school', 'attempts-2026-08-01.yml'), yaml.dump([
    { id: 'att_1', attributedTo: 'learner4', bankId: 'caps', correct: true },
  ]));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('school-rekey-learner (admin advocacy #8)', () => {
  it('dry run reports every move and edit and changes NOTHING', () => {
    const r = runRekey({ dataDir: root, oldId: 'learner4', newId: 'learner4-k', apply: false });
    expect(r.errors).toEqual([]);
    expect(r.moves.map((m) => path.basename(m.from))).toEqual(['learner4', 'learner4.yml']);
    expect(r.edits.length).toBeGreaterThanOrEqual(3);
    expect(fs.existsSync(path.join(root, 'users', 'learner4'))).toBe(true);
    const milestones = yaml.load(fs.readFileSync(path.join(root, 'household', 'apps', 'school', 'milestones.yml'), 'utf8'));
    expect(milestones[0].learnerId).toBe('learner4'); // untouched
  });

  it('--apply moves both roots and rewrites learner identities, leaving ADULT actors alone', () => {
    const r = runRekey({ dataDir: root, oldId: 'learner4', newId: 'learner4-k', apply: true });
    expect(r.errors).toEqual([]);
    expect(fs.existsSync(path.join(root, 'users', 'learner4-k'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'users', 'learner4'))).toBe(false);
    const school = path.join(root, 'household', 'apps', 'school');
    const assignment = yaml.load(fs.readFileSync(path.join(school, 'assignments', 'learner4-k.yml'), 'utf8'));
    expect(assignment).toMatchObject({ learnerId: 'learner4-k', assignedBy: 'kckern' }); // actor untouched
    const milestones = yaml.load(fs.readFileSync(path.join(school, 'milestones.yml'), 'utf8'));
    expect(milestones.map((m) => m.learnerId)).toEqual(['learner4-k', 'learner3']);
    const enrichment = yaml.load(fs.readFileSync(path.join(school, 'enrichment.yml'), 'utf8'));
    expect(enrichment[0].learnerIds).toEqual(['learner4-k', 'learner3']);
    const events = yaml.load(fs.readFileSync(path.join(school, 'sessions', '2026-08-01', 'ses_1.yml'), 'utf8'));
    expect(events[0].learnerId).toBe('learner4-k');
    // M8 fix 4: the reassigned event's own learner fields follow too — the
    // reducer sets learnerId from toLearnerId on the next reindex.
    expect(events[1]).toMatchObject({ fromLearnerId: 'learner4-k', toLearnerId: 'learner4-k', reassignedBy: 'kckern' });
    // M8 fix 5: identities INSIDE the moved user dir are rewritten, not just the dir name.
    const attempts = yaml.load(fs.readFileSync(path.join(root, 'users', 'learner4-k', 'apps', 'school', 'attempts-2026-08-01.yml'), 'utf8'));
    expect(attempts[0].attributedTo).toBe('learner4-k');
  });

  it('refuses when the new id already exists in either root', () => {
    fs.mkdirSync(path.join(root, 'users', 'taken'), { recursive: true });
    const r = runRekey({ dataDir: root, oldId: 'learner4', newId: 'taken', apply: true });
    expect(r.errors[0]).toMatch(/already exists/);
    expect(fs.existsSync(path.join(root, 'users', 'learner4'))).toBe(true);
  });

  it('rewriteLearnerIds never touches actor keys', () => {
    const doc = { learnerId: 'kid', gradedBy: 'kid', from: 'kid', assignedBy: 'kid', nested: [{ userId: 'kid', dismissedBy: 'kid' }] };
    const hits = rewriteLearnerIds(doc, 'kid', 'kid2');
    expect(hits).toBe(2);
    expect(doc).toEqual({ learnerId: 'kid2', gradedBy: 'kid', from: 'kid', assignedBy: 'kid', nested: [{ userId: 'kid2', dismissedBy: 'kid' }] });
  });
});
