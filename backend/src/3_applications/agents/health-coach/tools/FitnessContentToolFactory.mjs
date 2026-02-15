// backend/src/3_applications/agents/health-coach/tools/FitnessContentToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class FitnessContentToolFactory extends ToolFactory {
  static domain = 'fitness-content';

  createTools() {
    const { fitnessPlayableService, mediaProgressMemory, dataService } = this.deps;

    return [
      createTool({
        name: 'browse_fitness_catalog',
        description: 'List all fitness shows/programs available in the Plex fitness library. Returns show names, IDs, and episode counts.',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: async () => {
          try {
            const result = await fitnessPlayableService.listFitnessShows();
            return {
              shows: result.shows,
              libraryId: result.libraryId,
              total: result.shows.length,
            };
          } catch (err) {
            return { error: err.message, shows: [], total: 0 };
          }
        },
      }),

      createTool({
        name: 'get_fitness_content',
        description: 'Browse available fitness episodes for a Plex show. Returns episode list with watch state.',
        parameters: {
          type: 'object',
          properties: {
            showId: { type: 'string', description: 'Plex show ID (numeric string)' },
          },
          required: ['showId'],
        },
        execute: async ({ showId }) => {
          try {
            const result = await fitnessPlayableService.getPlayableEpisodes(showId);
            return {
              show: {
                id: `plex:${showId}`,
                title: result.containerItem?.title || 'Unknown',
              },
              episodes: (result.items || []).map(item => ({
                id: item.id,
                title: item.title,
                duration: Math.round((item.duration || 0) / 60),
                watched: (item.watchProgress || 0) >= 90,
                watchProgress: item.watchProgress || 0,
              })),
            };
          } catch (err) {
            return { error: err.message, show: null, episodes: [] };
          }
        },
      }),

      createTool({
        name: 'get_program_state',
        description: 'Read the user\'s current fitness program tracking state (position, schedule, status)',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            const state = dataService.user.read('agents/health-coach/program-state', userId);
            return { program: state?.program || null };
          } catch (err) {
            return { error: err.message, program: null };
          }
        },
      }),

      createTool({
        name: 'update_program_state',
        description: 'Update program tracking state (advance position, record substitutions, change status)',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            state: {
              type: 'object',
              description: 'Full program state object to persist',
              properties: {
                program: { type: 'object' },
              },
            },
          },
          required: ['userId', 'state'],
        },
        execute: async ({ userId, state }) => {
          try {
            dataService.user.write('agents/health-coach/program-state', state, userId);
            return { success: true };
          } catch (err) {
            return { error: err.message, success: false };
          }
        },
      }),

      createTool({
        name: 'get_recently_watched_fitness',
        description: 'Recently watched fitness videos from Plex watch history, with watch progress and last played date',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'number', description: 'Lookback window in days', default: 7 },
          },
        },
        execute: async ({ days = 7 }) => {
          if (!mediaProgressMemory) return { error: 'Media progress not available', items: [], total: 0 };
          try {
            const allProgress = await mediaProgressMemory.getAll('plex/14_fitness');
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

            const recent = allProgress
              .filter(p => p.lastPlayed && new Date(p.lastPlayed).getTime() >= cutoff)
              .sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime());

            return {
              items: recent.map(p => ({
                contentId: p.itemId,
                percent: p.percent ?? Math.round(((p.playhead || 0) / (p.duration || 1)) * 100),
                watched: (p.percent ?? 0) >= 90,
                lastPlayed: p.lastPlayed,
                durationMinutes: p.duration ? Math.round(p.duration / 60) : null,
              })),
              total: recent.length,
            };
          } catch (err) {
            return { error: err.message, items: [], total: 0 };
          }
        },
      }),
    ];
  }
}
