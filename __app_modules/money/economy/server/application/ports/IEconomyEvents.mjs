/**
 * What the economy tells the rest of the house after a write. Implemented by
 * an event-bus adapter and injected by composition; the economy never names a
 * topic or a consumer.
 *
 * coinsChanged({userId, reason}) — a ledger write moved a balance or a pass.
 *   `reason` is one of deposit | adjust | earn | mint | convert | pass-bought |
 *   pass-consumed | pass-refunded. Fired once per write, so a payout run that
 *   mints five lines fires five times; consumers coalesce. Never fired for a
 *   dry run, a duplicate or a refusal.
 */
export class IEconomyEvents {
  // eslint-disable-next-line no-unused-vars
  coinsChanged(fact) { throw new Error('IEconomyEvents.coinsChanged must be implemented'); }
}

export default IEconomyEvents;
