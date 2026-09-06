import { NutritionSurfaceSync } from '#apps/nutrition/NutritionSurfaceSync.mjs';
import { NutritionReceiptPublisher } from '#apps/nutrition/NutritionReceiptPublisher.mjs';
import { NutritionReceiptRenderer } from '#rendering/nutribot/NutritionReceiptRenderer.mjs';
import { YamlNutritionSurfaceCheckpoints } from '#adapters/persistence/yaml/YamlNutritionSurfaceCheckpoints.mjs';
import { TelegramNutribotIdentity } from '#adapters/nutribot/TelegramNutribotIdentity.mjs';

/** One receipt publisher shared by foreground captures and background review.
 * This projection remains optional: Telegram never gates household food saves. */
export function startNutritionSurfaceSync({ configService, userIdentityService, dataService, nutribotServices, logger, server }) {
  const identity = new TelegramNutribotIdentity({ configService, userIdentityService });
  const container = nutribotServices.nutribotContainer;
  const gateway = container.getMessagingGateway();
  if (gateway.available === false) return { stop() {} };
  const publisher = new NutritionReceiptPublisher({
    destinationFor: userId => identity.conversationIdFor(userId),
    linkFor: (log, destination) => log.conversationId === destination && /^\d+$/.test(String(log.metadata?.messageId || ''))
      ? { messageId: String(log.metadata.messageId), caption: log.metadata.messageKind
        ? log.metadata.messageKind === 'photo' : ['image', 'upc'].includes(log.metadata.source) } : null,
    foodLogs: nutribotServices.foodLogStore, items: nutribotServices.nutriListStore,
    checkpoints: new YamlNutritionSurfaceCheckpoints({ dataService }),
    renderer: new NutritionReceiptRenderer(),
    surface: {
      updateMessage: async (destination, link, receipt) => {
        try {
          await gateway.updateMessage(destination, link.messageId, {
            [link.caption ? 'caption' : 'text']: receipt.text, choices: receipt.choices, inline: true,
          });
        } catch (error) {
          const reason = error.response?.data?.description || error.message;
          if (/message is not modified/i.test(reason)) return;
          if (/message (to edit )?not found|message can't be edited|bot was blocked|chat not found/i.test(reason)) error.permanent = true;
          throw error;
        }
      },
    }, logger,
  });
  container.setReceiptPublisher(publisher);
  const sync = new NutritionSurfaceSync({ users: () => [...configService.getAllUserProfiles().keys()], publisher, logger });
  const run = () => sync.run().catch(error => logger.warn('nutrition.surface.retry', { error: error.message }));
  void run();
  const timer = setInterval(run, 15000);
  timer.unref?.();
  server?.once?.('close', () => clearInterval(timer));
  return { sync, publisher, stop: () => clearInterval(timer) };
}
