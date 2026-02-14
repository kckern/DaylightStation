// backend/tests/unit/agents/health-coach/FitnessContentToolFactory.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { FitnessContentToolFactory } from '../../../../src/3_applications/agents/health-coach/tools/FitnessContentToolFactory.mjs';

describe('FitnessContentToolFactory', () => {
  let factory;
  let mockFitnessPlayableService;
  let mockDataService;

  const sampleEpisodes = {
    containerItem: { title: 'P90X' },
    items: [
      { id: 'plex:101', title: 'Chest & Back', duration: 3600, watchProgress: 100, source: 'plex' },
      { id: 'plex:102', title: 'Plyometrics', duration: 3540, watchProgress: 0, source: 'plex' },
      { id: 'plex:103', title: 'Shoulders & Arms', duration: 3600, watchProgress: 0, source: 'plex' },
    ],
  };

  beforeEach(() => {
    mockFitnessPlayableService = {
      getPlayableEpisodes: async (showId) => sampleEpisodes,
    };

    mockDataService = {
      user: {
        read: (path, userId) => {
          if (path.includes('program-state')) {
            return { program: { id: 'p90x', content_source: 'plex:12345', current_day: 23, status: 'active' } };
          }
          return null;
        },
        write: () => true,
      },
    };

    factory = new FitnessContentToolFactory({
      fitnessPlayableService: mockFitnessPlayableService,
      dataService: mockDataService,
    });
  });

  describe('createTools', () => {
    it('should return 3 tools', () => {
      const tools = factory.createTools();
      assert.strictEqual(tools.length, 3);

      const names = tools.map(t => t.name);
      assert.ok(names.includes('get_fitness_content'));
      assert.ok(names.includes('get_program_state'));
      assert.ok(names.includes('update_program_state'));
    });
  });

  describe('get_fitness_content', () => {
    it('should return episodes for a show', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_fitness_content');
      const result = await tool.execute({ showId: '12345' });

      assert.ok(result.show);
      assert.ok(Array.isArray(result.episodes));
      assert.strictEqual(result.episodes.length, 3);
      assert.ok(result.episodes[0].id);
      assert.ok(result.episodes[0].title);
    });
  });

  describe('get_program_state', () => {
    it('should return program state from datastore', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_program_state');
      const result = await tool.execute({ userId: 'kckern' });

      assert.ok(result.program);
      assert.strictEqual(result.program.id, 'p90x');
      assert.strictEqual(result.program.status, 'active');
    });

    it('should return null program when no state exists', async () => {
      mockDataService.user.read = () => null;
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_program_state');
      const result = await tool.execute({ userId: 'kckern' });

      assert.strictEqual(result.program, null);
    });
  });

  describe('update_program_state', () => {
    it('should write state via DataService', async () => {
      let writtenPath, writtenData;
      mockDataService.user.write = (path, data, userId) => {
        writtenPath = path;
        writtenData = data;
        return true;
      };

      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'update_program_state');
      const result = await tool.execute({
        userId: 'kckern',
        state: { program: { id: 'p90x', current_day: 24, status: 'active' } },
      });

      assert.ok(result.success);
      assert.ok(writtenPath.includes('program-state'));
      assert.strictEqual(writtenData.program.current_day, 24);
    });
  });
});
