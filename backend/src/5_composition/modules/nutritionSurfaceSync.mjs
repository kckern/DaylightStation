import { NutritionSurfaceSync } from '#apps/nutrition/NutritionSurfaceSync.mjs';
import { YamlNutritionSurfaceCheckpoints } from '#adapters/persistence/yaml/YamlNutritionSurfaceCheckpoints.mjs';
import { TelegramNutribotIdentity } from '#adapters/nutribot/TelegramNutribotIdentity.mjs';
import { BudgetService } from '#apps/health/BudgetService.mjs';
import { YamlHealthGoalsDatastore } from '#adapters/persistence/yaml/YamlHealthGoalsDatastore.mjs';

/** Optional outbound projection; removing this wiring leaves Health fully usable. */
export function startNutritionSurfaceSync({ configService, userIdentityService, dataService, nutribotServices, logger, server }) {
  const identity = new TelegramNutribotIdentity({ configService, userIdentityService });
  const container = nutribotServices.nutribotContainer;
  const gateway = container.getMessagingGateway();
  const reports = container.getGenerateDailyReport();
  if (gateway.available === false) return { stop() {} };
  const budgetService = new BudgetService({
    goalsStore: new YamlHealthGoalsDatastore({ dataService }), healthStore: container.getHealthStore(),
    nutriListStore: nutribotServices.nutriListStore, clock: { now: () => Date.now() }, logger,
  });
  const pendingChoices = id => [[
    { text: 'Confirm', callback_data: JSON.stringify({ cmd: 'a', id }) },
    { text: 'Discard', callback_data: JSON.stringify({ cmd: 'x', id }) },
  ]];
  const sync = new NutritionSurfaceSync({
    users: () => [...configService.getAllUserProfiles().keys()],
    destinationFor: userId => identity.conversationIdFor(userId),
    linkFor: (log, destination) => log.conversationId === destination && /^\d+$/.test(String(log.metadata?.messageId || ''))
      ? { messageId: String(log.metadata.messageId), caption: ['image', 'upc'].includes(log.metadata.source) } : null,
    foodLogs: nutribotServices.foodLogStore,
    items: nutribotServices.nutriListStore,
    checkpoints: new YamlNutritionSurfaceCheckpoints({ dataService }),
    surface: {
      createPending: async (destination, id, text) => {
        const result = await gateway.sendMessage(destination, text.slice(0, 4000),
          { choices: pendingChoices(id), inline: true, silent: true });
        return { messageId: String(result.messageId), caption: false };
      },
      updateMessage: async (destination, link, text, options = {}) => {
        const limit = link.caption ? 1000 : 4000;
        const content = text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
        try {
          await gateway.updateMessage(destination, link.messageId, {
            [link.caption ? 'caption' : 'text']: content, choices: options.pending ? pendingChoices(options.pending) : [], inline: true,
          });
        } catch (error) {
          // Retrying a delivery after a crash may already have the correct text.
          const reason = error.response?.data?.description || error.message;
          if (/message is not modified/i.test(reason)) return;
          if (/message (to edit )?not found|message can't be edited|bot was blocked|chat not found/i.test(reason)) error.permanent = true;
          throw error;
        }
      },
      report: async ({ items, history, ...input }) => {
        const budget = await budgetService.getBudget(input.userId, input.date, { items });
        const goals = { calories: budget.budget + budget.exercise, calories_min: budget.budget + budget.exercise,
          calories_max: budget.budget + budget.exercise, protein: budget.goals?.macroGoals?.proteinG,
          carbs: budget.goals?.macroGoals?.carbsG, fat: budget.goals?.macroGoals?.fatG };
        const result = await reports.execute({ ...input, skipPendingCheck: true,
          syncSnapshot: { items, history, goals }, suppressCoaching: true });
        if (!result?.success || result.skipped) throw new Error('Nutrition report was not delivered');
      },
    },
    logger,
  });
  const run = () => sync.run().catch(error => logger.warn('nutrition.surface.retry', { error: error.message }));
  void run();
  const timer = setInterval(run, 15000);
  timer.unref?.();
  server?.once?.('close', () => clearInterval(timer));
  return { sync, stop: () => clearInterval(timer) };
}
