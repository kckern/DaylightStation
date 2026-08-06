import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runRekey, rewriteLearnerIds } from './school-rekey-learner.cli.mjs';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-rekey-'));
  const school = path.join(root, 'household', 'apps', 'school');
  fs.mkdirSync(path.join(school, 'assignments'), { recursive: true });
  fs.mkdirSync(path.join(school, 'sessions', '2026-08-01'), { recursive: true });
  fs.mkdirSync(path.join(root, 'users', 'felix', 'apps', 'school'), { recursive: true });
  fs.writeFileSync(path.join(school, 'assignments', 'felix.yml'), yaml.dump({ learnerId: 'felix', courses: ['math'], assignedBy: 'kckern' }));
  fs.writeFileSync(path.join(school, 'milestones.yml'), yaml.dump([
    { id: 'm1', learnerId: 'felix', unitId: 'u1' },
    { id: 'm2', learnerId: 'milo', unitId: 'u2' },
  ]));
  fs.writeFileSync(path.join(school, 'enrichment.yml'), yaml.dump([
    { id: 'e1', learnerIds: ['felix', 'milo'], recordedBy: 'kckern' },
  ]));
  fs.writeFileSync(path.join(school, 'sessions', '2026-08-01', 'ses_1.yml'), yaml.dump([
    { type: 'created', learnerId: 'felix', sessionId: 'ses_1' },
  ]));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('school-rekey-learner (admin advocacy #8)', () => {
  it('dry run reports every move and edit and changes NOTHING', () => {
    const r = runRekey({ dataDir: root, oldId: 'felix', newId: 'felix-k', apply: false });
    expect(r.errors).toEqual([]);
    expect(r.moves.map((m) => path.basename(m.from))).toEqual(['felix', 'felix.yml']);
    expect(r.edits.length).toBeGreaterThanOrEqual(3);
    expect(fs.existsSync(path.join(root, 'users', 'felix'))).toBe(true);
    const milestones = yaml.load(fs.readFileSync(path.join(root, 'household', 'apps', 'school', 'milestones.yml'), 'utf8'));
    expect(milestones[0].learnerId).toBe('felix'); // untouched
  });

  it('--apply moves both roots and rewrites learner identities, leaving ADULT actors alone', () => {
    const r = runRekey({ dataDir: root, oldId: 'felix', newId: 'felix-k', apply: true });
    expect(r.errors).toEqual([]);
    expect(fs.existsSync(path.join(root, 'users', 'felix-k'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'users', 'felix'))).toBe(false);
    const school = path.join(root, 'household', 'apps', 'school');
    const assignment = yaml.load(fs.readFileSync(path.join(school, 'assignments', 'felix-k.yml'), 'utf8'));
    expect(assignment).toMatchObject({ learnerId: 'felix-k', assignedBy: 'kckern' }); // actor untouched
    const milestones = yaml.load(fs.readFileSync(path.join(school, 'milestones.yml'), 'utf8'));
    expect(milestones.map((m) => m.learnerId)).toEqual(['felix-k', 'milo']);
    const enrichment = yaml.load(fs.readFileSync(path.join(school, 'enrichment.yml'), 'utf8'));
    expect(enrichment[0].learnerIds).toEqual(['felix-k', 'milo']);
    const events = yaml.load(fs.readFileSync(path.join(school, 'sessions', '2026-08-01', 'ses_1.yml'), 'utf8'));
    expect(events[0].learnerId).toBe('felix-k');
  });

  it('refuses when the new id already exists in either root', () => {
    fs.mkdirSync(path.join(root, 'users', 'taken'), { recursive: true });
    const r = runRekey({ dataDir: root, oldId: 'felix', newId: 'taken', apply: true });
    expect(r.errors[0]).toMatch(/already exists/);
    expect(fs.existsSync(path.join(root, 'users', 'felix'))).toBe(true);
  });

  it('rewriteLearnerIds never touches actor keys', () => {
    const doc = { learnerId: 'kid', gradedBy: 'kid', from: 'kid', assignedBy: 'kid', nested: [{ userId: 'kid', dismissedBy: 'kid' }] };
    const hits = rewriteLearnerIds(doc, 'kid', 'kid2');
    expect(hits).toBe(2);
    expect(doc).toEqual({ learnerId: 'kid2', gradedBy: 'kid', from: 'kid', assignedBy: 'kid', nested: [{ userId: 'kid2', dismissedBy: 'kid' }] });
  });
});
