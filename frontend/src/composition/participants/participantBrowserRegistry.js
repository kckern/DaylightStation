import {PartyGamesParticipantAdapter, PartyGamesParticipantPassthrough, PartyGamesParticipantPreview, isPartyGamesParticipantPreview} from '../../../../__app_modules/games/party-games/browser/participants.mjs';

/** Registered consumers alone may receive the explicit ready result. */
export function createParticipantBrowserRegistry(entries = []) {
  const registrations = new Map();
  const passthroughs = new Map();
  const previews = new Map();
  for (const entry of entries) {
    const { consumer, outputSchema, render } = entry;
    if (!consumer?.id || !Number.isSafeInteger(consumer.version) || !outputSchema || typeof render !== 'function') throw new Error('Invalid participant browser adapter');
    const key = JSON.stringify([consumer.id, consumer.version, outputSchema]);
    if (registrations.has(key)) throw new Error('Duplicate participant browser adapter');
    registrations.set(key, render);
    if (entry.previewSchema || entry.preview || entry.validatePreview) {
      const previewKey = JSON.stringify([consumer.id, consumer.version, entry.previewSchema]);
      if (!entry.previewSchema || typeof entry.preview !== 'function' || (entry.validatePreview && typeof entry.validatePreview !== 'function') || previews.has(previewKey)) throw new Error('Invalid participant preview adapter');
      previews.set(previewKey, {render:entry.preview, validate:entry.validatePreview});
    }
    if (entry.passthrough) {
      const consumerKey = JSON.stringify([consumer.id, consumer.version]);
      if (typeof entry.passthrough !== 'function' || passthroughs.has(consumerKey)) throw new Error('Invalid participant passthrough adapter');
      passthroughs.set(consumerKey, entry.passthrough);
    }
  }
  return { supports(consumer) {
    return [...registrations.keys()].some(key => { const [id, version] = JSON.parse(key); return id === consumer?.id && version === consumer?.version; });
  }, resolvePassthrough(consumer) {
    return passthroughs.get(JSON.stringify([consumer?.id, consumer?.version])) || null;
  }, resolvePreview(options) {
    const {consumer, consumer_summary:summary} = options || {};
    const entry = previews.get(JSON.stringify([consumer?.id, consumer?.version, summary?.schema]));
    return entry && (!entry.validate || entry.validate(summary.data)) ? entry.render : null;
  }, resolve(result) {
    const { consumer, output } = result || {};
    return registrations.get(JSON.stringify([consumer?.id, consumer?.version, output?.schema])) || null;
  } };
}
export const participantBrowserRegistry = createParticipantBrowserRegistry([{consumer:{id:'party-games',version:1},outputSchema:'party-games-launch-result/v1',render:PartyGamesParticipantAdapter,passthrough:PartyGamesParticipantPassthrough,previewSchema:'party-games-preview/v2',preview:PartyGamesParticipantPreview,validatePreview:isPartyGamesParticipantPreview}]);
