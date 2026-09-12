/**
 * Append-only record of play time granted to a person.
 *
 * Append-only because granted time is money: an overwritten balance is an
 * unauditable one, and "who gave this child forty minutes, and when" has to stay
 * answerable. A balance is the fold of its entries, never a stored number.
 *
 * Entries are day-scoped. Play time that quietly carried forever would make
 * "you have none left" untrue tomorrow, so the day is part of the address.
 */
export class IPlayGrantLedger {
  /** @returns {Promise<{grantedMs: number, entries: object[]}>} */
  async forUserOn(_userId, _isoDate) { throw new Error('IPlayGrantLedger.forUserOn must be implemented'); }
  /** @returns {Promise<object>} the appended entry */
  async append(_userId, _isoDate, _entry) { throw new Error('IPlayGrantLedger.append must be implemented'); }
}
