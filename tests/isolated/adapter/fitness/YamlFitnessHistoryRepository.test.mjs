import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlFitnessHistoryRepository } from '#adapters/fitness/YamlFitnessHistoryRepository.mjs';

const ID = '20260919104104';
const session = (tickCount, duration) => ({
  sessionId: ID,
  session: { id: ID, duration_seconds: duration, source: 'strava' },
  timeline: { interval_seconds: 5, tick_count: tickCount, series: { 'kc:hr': Array(tickCount).fill(130) } },
});

describe('YamlFitnessHistoryRepository integrity + snapshot', () => {
  let root;
  let logger;
  let repo;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlog-'));
    logger = { warn: vi.fn() };
    repo = new YamlFitnessHistoryRepository({ root: path.join(root, 'log'), logger });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const read = () => yaml.load(fs.readFileSync(path.join(root, 'log', '2026-09-19', `${ID}.yml`), 'utf8'));

  it('stamps and warns when a Strava timeline is far shorter than the activity', () => {
    const { integrity } = repo.save(ID, session(208, 4920));
    expect(integrity.violations[0].check).toBe('coverage');
    expect(read().integrity.ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('fitness.session.integrity_violation', expect.objectContaining({ sessionId: ID }));
  });

  it('clears the stamp once the session is consistent', () => {
    repo.save(ID, session(208, 4920));
    repo.save(ID, { ...session(984, 4920), integrity: { ok: false } });
    expect(read().integrity).toBeUndefined();
  });

  it('snapshot copies the current file aside and returns its path', () => {
    repo.save(ID, session(984, 4920));
    const target = repo.snapshot(ID, 'timeline-rebuild');
    expect(target).toContain(path.join('log-backups', '2026-09-19'));
    expect(yaml.load(fs.readFileSync(target, 'utf8')).timeline.tick_count).toBe(984);
    expect(repo.snapshot('20200101000000')).toBeNull();
  });
});
