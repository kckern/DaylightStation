// @vitest-environment node
/**
 * The composed agenda economy port (`bankSummary`): what it asks the economy,
 * what it answers for the edge cases, and that it writes nothing.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAgendaEconomyPort } from './agendaEconomy.mjs';
import { YamlEconomyDatastore } from '../../../../money/economy/server/adapters/persistence/YamlEconomyDatastore.mjs';
import { EconomyConfigProjection } from '../../../../money/economy/server/adapters/config/EconomyConfigProjection.mjs';
import { EconomyService } from '../../../../money/economy/server/application/EconomyService.mjs';

const recorder = () => {
  const calls = [];
  const log = (level) => (event, data) => calls.push({ level, event, data });
  return { calls, logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') } };
};

const fakeEconomy = ({ known = ['kid1'], silver = 7 } = {}) => {
  const asked = [];
  return {
    asked,
    hasUser: (id) => known.includes(id),
    peekBalance: async (id) => { asked.push(['peekBalance', id]); return { silver, gold: 0, gems: 0 }; },
    getBalance: async (id) => { asked.push(['getBalance', id]); throw new Error('getBalance writes; must not be called'); },
  };
};
const preview = async () => ({ subject: 'math', unit: { unitId: 'u1', title: 'Math', subject: 'math' }, printable: true, reward: null });

describe('createAgendaEconomyPort', () => {
  it('answers the unspent silver and the next item, through peekBalance only', async () => {
    const economy = fakeEconomy();
    const port = createAgendaEconomyPort({ economyService: economy, previewNext: preview, logger: recorder().logger });
    expect(await port.bankSummary('kid1')).toEqual({ silver: 7, next: { title: 'Math', reward: null } });
    expect(economy.asked).toEqual([['peekBalance', 'kid1']]);
  });

  it('a throwing preview still answers the silver, and warns', async () => {
    const { calls, logger } = recorder();
    const port = createAgendaEconomyPort({
      economyService: fakeEconomy(), logger,
      previewNext: () => { throw new Error('planner is down'); },
    });
    expect(await port.bankSummary('kid1')).toEqual({ silver: 7, next: null });
    expect(calls).toEqual([{
      level: 'warn', event: 'school.agenda.economy-next-failed', data: { learnerId: 'kid1', error: 'planner is down' },
    }]);
  });

  it('an unknown economy user gets no line, no warn, and one info per learner', async () => {
    const { calls, logger } = recorder();
    const economy = fakeEconomy({ known: [] });
    const port = createAgendaEconomyPort({ economyService: economy, previewNext: preview, logger });
    expect(await port.bankSummary('stranger')).toBeNull();
    expect(await port.bankSummary('stranger')).toBeNull();
    expect(await port.bankSummary('other')).toBeNull();
    expect(economy.asked).toEqual([]);
    expect(calls).toEqual([
      { level: 'info', event: 'school.agenda.economy-unknown-user', data: { learnerId: 'stranger' } },
      { level: 'info', event: 'school.agenda.economy-unknown-user', data: { learnerId: 'other' } },
    ]);
  });

  it('a failing balance read throws, for BuildAgenda to catch and warn', async () => {
    const economy = { hasUser: () => true, peekBalance: async () => { throw new Error('ledger unreadable'); } };
    const port = createAgendaEconomyPort({ economyService: economy, previewNext: preview, logger: recorder().logger });
    await expect(port.bankSummary('kid1')).rejects.toThrow('ledger unreadable');
  });

  it('is absent without peekBalance, so the agenda prints as before', () => {
    expect(createAgendaEconomyPort({ economyService: null, previewNext: preview })).toBeNull();
    expect(createAgendaEconomyPort({ economyService: { getBalance: async () => ({}) }, previewNext: preview })).toBeNull();
  });

  describe('against the real EconomyService', () => {
    let dir;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-economy-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('writes no wallet', async () => {
      const configService = {
        getUserProfile: (id) => (id === 'kid1' ? { id } : null),
        getUserDir: () => dir,
        getHouseholdAppConfig: () => ({ currency: { name: 'coins' }, earn: {}, spend: {}, users: {} }),
      };
      const economyService = new EconomyService({
        datastore: new YamlEconomyDatastore({ configService }),
        configProjection: new EconomyConfigProjection({ configService }),
        logger: recorder().logger,
      });
      const port = createAgendaEconomyPort({ economyService, previewNext: preview, logger: recorder().logger });
      expect(await port.bankSummary('kid1')).toEqual({ silver: 0, next: { title: 'Math', reward: null } });
      expect(fs.readdirSync(dir, { recursive: true })).toEqual([]);
    });
  });
});
