/**
 * One retryable attached-session orchestration.
 *
 * Every mutating stage has its own durable idempotency boundary. If a later
 * stage fails, replaying this command resumes instead of duplicating work.
 */
export class SyncSchoolCalcDevice {
  #profiles; #progress; #observe; #importQueue; #requests; #interactions; #plan;

  constructor({ profiles, progress, observe, importQueue, requests, interactions = null, plan } = {}) {
    if (!profiles || !progress || !observe || !importQueue || !requests || !plan) {
      throw new Error('SyncSchoolCalcDevice requires profiles, progress, observe, importQueue, requests, and plan');
    }
    this.#profiles = profiles;
    this.#progress = progress;
    this.#observe = observe;
    this.#importQueue = importQueue;
    this.#requests = requests;
    this.#interactions = interactions;
    this.#plan = plan;
  }

  async execute({
    deviceId,
    relayId,
    rawInfo = null,
    rawState = null,
    resultQueue = null,
    requestRecord = null,
    interactionRecord = null,
    catalogGeneration = null,
  } = {}) {
    // Refresh bindings before importing an old offline queue. Retired bindings
    // remain in the aggregate, so this cannot reassign historical work.
    const profiles = await this.#profiles.execute({ deviceId });
    const observation = rawInfo === null
      ? null
      : await this.#observe.execute({ deviceId, relayId, rawInfo, rawState });
    const results = resultQueue === null
      ? null
      : await this.#importQueue.execute({ deviceId, record: resultQueue });
    const deliveries = requestRecord === null
      ? null
      : await this.#requests.execute({ deviceId, record: requestRecord });
    const interaction = interactionRecord === null
      ? null
      : await this.#exchangeInteraction({ deviceId, record: interactionRecord });
    // Query after queue import so the same response can show newly accepted
    // offline assessment evidence. The projection contains every active
    // learner, not whichever profile happened to be selected at attachment.
    const progress = await this.#progress.execute({ deviceId });
    // Acknowledgements are scoped to the exact queue uploaded in this
    // transaction. Re-emitting the device's lifetime ledger would make an
    // acknowledgement record grow forever and could authorize deletion of
    // bytes never observed in this attached session.
    const acknowledgementSequences = results?.outcomes
      ?.filter((entry) => entry?.acknowledge === true)
      .map((entry) => entry.sequence) ?? [];
    const deliveryAcknowledgementIds = deliveries?.requests
      ?.filter((entry) => entry?.acknowledge === true)
      .map((entry) => entry.requestId) ?? [];
    const plan = await this.#plan.execute({
      deviceId,
      catalogGeneration,
      acknowledgementSequences,
      deliveryAcknowledgementIds,
      queueRecordBytes: resultQueue === null ? null : byteLength(resultQueue),
      profileRecordBytes: byteLength(profiles.record),
      progressRecordBytes: byteLength(progress.record),
      interactionResponseBytes: interaction === null ? null : byteLength(interaction.record),
    });
    return { profiles, progress, observation, results, deliveries, interaction, plan };
  }

  async #exchangeInteraction(input) {
    if (!this.#interactions || typeof this.#interactions.execute !== 'function') {
      throw new Error('SchoolCalc interaction exchange is not configured');
    }
    return this.#interactions.execute(input);
  }
}

function byteLength(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (typeof value === 'string') return Buffer.byteLength(value);
  throw new Error('SchoolCalc sync record must be bytes or text');
}

export default SyncSchoolCalcDevice;
